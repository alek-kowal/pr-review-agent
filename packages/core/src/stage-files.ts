// Which instruction files each agent stage reads (STAGEFILES). A stage declares named slots
// (`packages/agents/src/pipeline.ts`); a choice per slot is a setting at global scope with an
// optional repository override, and a run freezes the resolved files when it starts.
import type { InstructionStage } from './instructions.ts';

/** The pipeline stages whose agent reads instruction files (pipeline keys, so `analyst`). */
export const FILE_STAGE_KEYS = ['change_type', 'review', 'verify', 'implement', 'analyst'] as const;
export type FileStageKey = (typeof FILE_STAGE_KEYS)[number];

export const isFileStageKey = (key: string): key is FileStageKey =>
  (FILE_STAGE_KEYS as readonly string[]).includes(key);

/** The run stage that needs files (`INSTRUCTION_STAGES`) → its pipeline stage. */
export const FILE_STAGE_OF_INSTRUCTION_STAGE: Readonly<Record<InstructionStage, FileStageKey>> = {
  verify: 'verify',
  implement: 'implement',
  analyse: 'analyst',
};

export const STAGE_SLOT_NAMES = ['prompt', 'rules', 'documents'] as const;
export type StageSlotName = (typeof STAGE_SLOT_NAMES)[number];

/** The choice of the built-in prompt, for a slot that has one (the reviewer's prompt). */
export const BUILT_IN_FILE = '@built-in';

/** A documents default: every Markdown document the run resolves. */
export const ALL_MARKDOWN_DOCUMENTS = 'all-markdown';

/** One slot a stage declares, with the file it reads when nobody picked another. */
export type StageSlotDecl =
  | {
      name: 'prompt' | 'rules';
      kind: 'instruction';
      default: string;
      /** The slot may use the built-in prompt (`BUILT_IN_FILE`). */
      builtIn?: boolean;
      /** The stage cannot run without the file (`REQUIRED_INSTRUCTION_FILES`). */
      required?: boolean;
    }
  | {
      name: 'documents';
      kind: 'document';
      default: readonly string[] | typeof ALL_MARKDOWN_DOCUMENTS;
    };

/**
 * A stored choice for one stage at one scope. A missing (or null) slot inherits: a repository
 * choice from the global one, a global choice from the slot's default.
 */
export interface StageFileChoice {
  prompt?: string | null;
  rules?: string | null;
  documents?: string[] | null;
}

/** The files one stage reads. A null prompt is the built-in one; a null rules slot reads none. */
export interface StageFiles {
  prompt: string | null;
  rules: string | null;
  documents: string[];
}

/** What a run froze when it started, per stage that reads files. */
export type FrozenStageFiles = Partial<Record<FileStageKey, StageFiles>>;

/** Where a slot's value comes from. */
export type StageSlotSource = 'default' | 'global' | 'repository';

export interface StageFileChoices {
  global: Partial<Record<FileStageKey, StageFileChoice>>;
  /** Empty at global scope. */
  repository: Partial<Record<FileStageKey, StageFileChoice>>;
}

export interface ResolvedStageSlot {
  name: StageSlotName;
  source: StageSlotSource;
  /** The chosen keys: one for prompt and rules (`BUILT_IN_FILE` for built in), the documents. */
  value: string[];
}

const isSet = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;

/** The Markdown keys of `documentKeys`, sorted: what `ALL_MARKDOWN_DOCUMENTS` reads. */
export function markdownDocuments(documentKeys: readonly string[]): string[] {
  return [...new Set(documentKeys.filter((key) => key.endsWith('.md')))].sort();
}

/** One stage's slots resolved: repository choice, then global choice, then the default. */
export function resolveStageSlots(
  slots: readonly StageSlotDecl[],
  global: StageFileChoice | undefined,
  repository: StageFileChoice | undefined,
  documentKeys: readonly string[],
): ResolvedStageSlot[] {
  return slots.map((slot) => {
    const fromRepository = repository?.[slot.name];
    const fromGlobal = global?.[slot.name];
    const source: StageSlotSource = isSet(fromRepository)
      ? 'repository'
      : isSet(fromGlobal)
        ? 'global'
        : 'default';
    const chosen = isSet(fromRepository) ? fromRepository : isSet(fromGlobal) ? fromGlobal : null;
    if (slot.name === 'documents') {
      const value = Array.isArray(chosen)
        ? [...new Set(chosen)]
        : slot.default === ALL_MARKDOWN_DOCUMENTS
          ? markdownDocuments(documentKeys)
          : [...slot.default];
      return { name: slot.name, source, value };
    }
    const value = typeof chosen === 'string' ? chosen : slot.default;
    return { name: slot.name, source, value: [value] };
  });
}

/** The files one stage reads, from its resolved slots. */
export function stageFilesOfSlots(resolved: readonly ResolvedStageSlot[]): StageFiles {
  const one = (name: 'prompt' | 'rules') => {
    const key = resolved.find((slot) => slot.name === name)?.value[0];
    return key === undefined || key === BUILT_IN_FILE ? null : key;
  };
  return {
    prompt: one('prompt'),
    rules: one('rules'),
    documents: resolved.find((slot) => slot.name === 'documents')?.value ?? [],
  };
}

/** Every stage's files for one target (global scope when `choices.repository` is empty). */
export function resolveStageFiles(
  slotsByStage: Partial<Record<FileStageKey, readonly StageSlotDecl[]>>,
  choices: StageFileChoices,
  documentKeys: readonly string[],
): FrozenStageFiles {
  const out: FrozenStageFiles = {};
  for (const stage of FILE_STAGE_KEYS) {
    const slots = slotsByStage[stage];
    if (!slots?.length) continue;
    out[stage] = stageFilesOfSlots(
      resolveStageSlots(slots, choices.global[stage], choices.repository[stage], documentKeys),
    );
  }
  return out;
}

/** The stages whose files include `fileKey`, in pipeline order. */
export function stageFileReaders(fileKey: string, stageFiles: FrozenStageFiles): FileStageKey[] {
  return FILE_STAGE_KEYS.filter((stage) => {
    const files = stageFiles[stage];
    return (
      !!files &&
      (files.prompt === fileKey || files.rules === fileKey || files.documents.includes(fileKey))
    );
  });
}

/** Whether a choice picks nothing (every slot inherits), so its row can go. */
export function isEmptyStageFileChoice(choice: StageFileChoice | null | undefined): boolean {
  return !choice || STAGE_SLOT_NAMES.every((name) => !isSet(choice[name]));
}
