// STAGEFILES: which instruction files each stage reads, as a signed setting at global scope with
// an optional repository override. The store, the validation of a choice and the view Settings →
// Pipeline draws for one scope (and that "Read by" in Settings → Instructions uses).
import { slotsOf, stageFilesFor } from '@pra/agents';
import {
  BUILT_IN_FILE,
  defaultKindOf,
  FILE_STAGE_KEYS,
  INSTRUCTION_KINDS,
  INSTRUCTION_SCOPES,
  isEmptyStageFileChoice,
  isFileStageKey,
  resolveStageSlots,
  stageFileReaders,
  STAGE_SLOT_NAMES,
  type FileStageKey,
  type InstructionKind,
  type InstructionScope,
  type StageFileChoice,
  type StageFileChoices,
} from '@pra/core';
import { lockStageFileChoice, writeStageFileChoice, type InstructionFileSummary } from '@pra/db';
import { z } from 'zod/v4';
import type { SettingsStore } from './signed-change.ts';

export const STAGE_FILES_AREA = 'stage_files';

export const StageFileChoiceSchema = z
  .object({
    prompt: z.string().trim().min(1).nullable().optional(),
    rules: z.string().trim().min(1).nullable().optional(),
    documents: z.array(z.string().trim().min(1)).nullable().optional(),
  })
  .strict();

/** A choice with only the slots it sets (documents without repeats), or null when it sets none. */
export function normalChoice(choice: StageFileChoice | null | undefined): StageFileChoice | null {
  if (!choice || isEmptyStageFileChoice(choice)) return null;
  const out: StageFileChoice = {};
  if (choice.prompt != null) out.prompt = choice.prompt;
  if (choice.rules != null) out.rules = choice.rules;
  if (choice.documents != null) out.documents = [...new Set(choice.documents)];
  return out;
}

/** The log's entity: `global/<stage>` or `<repositoryId>/<stage>`. */
export const stageFilesEntity = (repositoryId: number | null, stage: FileStageKey) =>
  `${repositoryId ?? 'global'}/${stage}`;

function parseEntity(entity: string): { repositoryId: number | null; stage: FileStageKey } {
  const [target, stage] = entity.split('/');
  if (!stage || !isFileStageKey(stage)) throw new Error(`stage files entity "${entity}"`);
  return { repositoryId: target === 'global' ? null : Number(target), stage };
}

export function stageFilesStore(): SettingsStore<StageFileChoice> {
  return {
    area: STAGE_FILES_AREA,
    read: (tx, entity) => {
      const { repositoryId, stage } = parseEntity(entity);
      return lockStageFileChoice(tx, repositoryId, stage);
    },
    async write(tx, entity, after) {
      const { repositoryId, stage } = parseEntity(entity);
      const value = normalChoice(after);
      await writeStageFileChoice(tx, repositoryId, stage, value);
      return { entity, value };
    },
  };
}

/** The files a scope sees: global files, and at repository scope that repository's copies. */
export function filesAt(
  files: readonly InstructionFileSummary[],
  repositoryId: number | null,
): InstructionFileSummary[] {
  return files.filter(
    (f) =>
      f.scope === 'global' ||
      (repositoryId !== null && f.scope === 'repository' && f.repositoryId === repositoryId),
  );
}

type Problem = {
  code: 'stage_file_unknown' | 'stage_file_kind' | 'stage_file_slot';
  params: Record<string, unknown>;
};

/**
 * Why `after` cannot be saved for `stage` at a scope that sees `visible`, or null. Only slots that
 * change from `before` are checked, so a choice whose file has gone can still be edited elsewhere.
 */
export function stageFileChoiceProblem(
  stage: FileStageKey,
  before: StageFileChoice | null,
  after: StageFileChoice | null,
  visible: readonly InstructionFileSummary[],
): Problem | null {
  if (!after) return null;
  const slots = slotsOf(stage);
  const kindOf = (fileKey: string) => visible.find((f) => f.fileKey === fileKey)?.kind;
  const checkFile = (fileKey: string, wanted: InstructionKind): Problem | null => {
    const kind = kindOf(fileKey);
    if (!kind) return { code: 'stage_file_unknown', params: { fileKey } };
    return kind === wanted ? null : { code: 'stage_file_kind', params: { fileKey, kind } };
  };
  for (const name of STAGE_SLOT_NAMES) {
    const value = after[name];
    if (value == null) continue;
    if (JSON.stringify(value) === JSON.stringify(before?.[name] ?? null)) continue;
    const slot = slots.find((s) => s.name === name);
    if (!slot) return { code: 'stage_file_slot', params: { slot: name } };
    const keys = Array.isArray(value) ? value : [value];
    for (const key of keys) {
      if (key === BUILT_IN_FILE) {
        if (slot.name === 'documents' || !slot.builtIn) {
          return { code: 'stage_file_slot', params: { slot: name } };
        }
        continue;
      }
      const problem = checkFile(key, slot.kind);
      if (problem) return problem;
    }
  }
  return null;
}

// The view.

export const FileOptionSchema = z.object({
  fileKey: z.string(),
  kind: z.enum(INSTRUCTION_KINDS),
  /** The file the scope reads: the repository's copy, else the global file; null when none. */
  fileId: z.number().int().nullable(),
  version: z.number().int().nullable(),
  scope: z.enum(INSTRUCTION_SCOPES).nullable(),
  /** At Global scope, a key with no global file: the repositories that hold a copy. */
  copies: z.array(z.string()).optional(),
});
export type FileOption = z.output<typeof FileOptionSchema>;

export const StageSlotViewSchema = z.object({
  name: z.enum(STAGE_SLOT_NAMES),
  kind: z.enum(INSTRUCTION_KINDS),
  builtIn: z.boolean(),
  required: z.boolean(),
  /** Where the value comes from at this scope. */
  source: z.enum(['default', 'global', 'repository']),
  /** The keys read: one for prompt and rules (`@built-in` for the built-in prompt), the documents. */
  value: z.array(z.string()),
  /** The value's files at this scope (none for the built-in prompt). */
  files: z.array(FileOptionSchema),
});

export const StageFilesViewSchema = z.object({
  /** The stored choices, as `before` for a save at this scope. */
  choice: z.object({
    global: StageFileChoiceSchema.nullable(),
    repository: StageFileChoiceSchema.nullable(),
  }),
  slots: z.array(StageSlotViewSchema),
});
export type StageFilesView = z.output<typeof StageFilesViewSchema>;

/** One key at a scope: the repository's copy with an active version, else the global file. */
export function fileOptionAt(
  files: readonly InstructionFileSummary[],
  fileKey: string,
  repositoryId: number | null,
): FileOption {
  const same = files.filter((f) => f.fileKey === fileKey);
  const own = repositoryId === null ? undefined : same.find((f) => f.repositoryId === repositoryId);
  const global = same.find((f) => f.scope === 'global');
  const file =
    (own?.active ? own : undefined) ?? (global?.active ? global : undefined) ?? own ?? global;
  // A key with no file yet takes the kind a new file of that name would get.
  const kind = (file ?? same[0])?.kind ?? defaultKindOf(fileKey);
  const option: FileOption = {
    fileKey,
    kind: kind as InstructionKind,
    fileId: file?.id ?? null,
    version: file?.active?.version ?? null,
    scope: (file?.scope as InstructionScope | undefined) ?? null,
  };
  if (!file && repositoryId === null) {
    const copies = same
      .filter((f) => f.scope === 'repository' && f.repositorySlug)
      .map((f) => f.repositorySlug!);
    if (copies.length) option.copies = [...new Set(copies)].sort();
  }
  return option;
}

/** The scope's files of one kind, by key. */
export function fileOptions(
  files: readonly InstructionFileSummary[],
  repositoryId: number | null,
  kind: InstructionKind,
): FileOption[] {
  const keys = [
    ...new Set(
      filesAt(files, repositoryId)
        .filter((f) => f.kind === kind)
        .map((f) => f.fileKey),
    ),
  ].sort();
  return keys.map((key) => fileOptionAt(files, key, repositoryId));
}

/** The document keys a scope sees: what the reviewer's "all Markdown documents" expands to. */
export const documentKeysAt = (
  files: readonly InstructionFileSummary[],
  repositoryId: number | null,
) =>
  filesAt(files, repositoryId)
    .filter((f) => f.kind === 'document')
    .map((f) => f.fileKey);

/** One stage's slots at a scope (global when `repositoryId` is null). */
export function stageFilesView(
  stage: FileStageKey,
  choices: StageFileChoices,
  files: readonly InstructionFileSummary[],
  repositoryId: number | null,
): StageFilesView {
  const slots = slotsOf(stage);
  const resolved = resolveStageSlots(
    slots,
    choices.global[stage],
    choices.repository[stage],
    documentKeysAt(files, repositoryId),
  );
  return {
    choice: {
      global: normalChoice(choices.global[stage]),
      repository: repositoryId === null ? null : normalChoice(choices.repository[stage]),
    },
    slots: resolved.map((r) => {
      const decl = slots.find((s) => s.name === r.name)!;
      return {
        name: r.name,
        kind: decl.kind,
        builtIn: decl.name !== 'documents' && !!decl.builtIn,
        required: decl.name !== 'documents' && !!decl.required,
        source: r.source,
        value: r.value,
        files: r.value
          .filter((key) => key !== BUILT_IN_FILE)
          .map((key) => fileOptionAt(files, key, repositoryId)),
      };
    }),
  };
}

export const ReadBySchema = z.object({
  stage: z.enum(FILE_STAGE_KEYS),
  /** The repository whose runs read it this way; null for the global choice. */
  repository: z.string().nullable(),
});
export type ReadBy = z.output<typeof ReadBySchema>;

/**
 * Who reads each file ("Read by"): a global or level file is read by the global choice's stages
 * and by each repository override that names its key; a repository copy by that repository's
 * resolved stages. Keyed by file id.
 */
export function readersOfFiles(
  files: readonly InstructionFileSummary[],
  choices: {
    global: StageFileChoices['global'];
    repositories: Map<number, StageFileChoices['repository']>;
  },
  slugs: ReadonlyMap<number, string>,
): Map<number, ReadBy[]> {
  const globalFiles = stageFilesFor(
    { global: choices.global, repository: {} },
    documentKeysAt(files, null),
  );
  const repositoryFiles = new Map(
    [...slugs.keys()].map((id) => [
      id,
      stageFilesFor(
        { global: choices.global, repository: choices.repositories.get(id) ?? {} },
        documentKeysAt(files, id),
      ),
    ]),
  );
  const out = new Map<number, ReadBy[]>();
  for (const file of files) {
    if (file.scope === 'repository') {
      const resolved =
        file.repositoryId === null ? undefined : repositoryFiles.get(file.repositoryId);
      const slug = file.repositorySlug;
      out.set(
        file.id,
        resolved
          ? stageFileReaders(file.fileKey, resolved).map((stage) => ({ stage, repository: slug }))
          : [],
      );
      continue;
    }
    const readers: ReadBy[] = stageFileReaders(file.fileKey, globalFiles).map((stage) => ({
      stage,
      repository: null,
    }));
    for (const [id, overrides] of choices.repositories) {
      const resolved = repositoryFiles.get(id);
      if (!resolved) continue;
      for (const stage of stageFileReaders(file.fileKey, resolved)) {
        const own = overrides[stage];
        const names =
          own && [own.prompt, own.rules, ...(own.documents ?? [])].includes(file.fileKey);
        if (names) readers.push({ stage, repository: slugs.get(id) ?? null });
      }
    }
    out.set(file.id, readers);
  }
  return out;
}
