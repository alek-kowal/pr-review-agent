// Instruction files by scope (S-22, FR-003, FR-079): which version of each file a run reads.
import './reasons/instructions.ts';
import { FEATURE_ON_FROM, STAGE_ON_FROM } from './levels.ts';
import { reason, type Reason } from './reason.ts';
import { LEVEL_NUMBERS, type LevelNumber } from './vocabulary.ts';

/** Global files apply everywhere, a repository copy in one repository, a level copy at a level. */
export const INSTRUCTION_SCOPES = ['global', 'repository', 'level'] as const;
export type InstructionScope = (typeof INSTRUCTION_SCOPES)[number];

/** Resolution order: a later scope beats an earlier one for the same file key. */
const SCOPE_RANK: Readonly<Record<InstructionScope, number>> = {
  global: 0,
  repository: 1,
  level: 2,
};

/** One version of one instruction file, as resolution reads it. */
export interface InstructionLayer {
  versionId: number;
  fileKey: string;
  scope: InstructionScope;
  /** Set for a repository copy only. */
  repositoryId: number | null;
  /** Set for a level copy only. */
  level: LevelNumber | null;
  version: number;
  content: string;
}

export interface InstructionTarget {
  repositoryId: number;
  level: LevelNumber;
}

export interface ResolvedInstruction {
  fileKey: string;
  content: string;
  /** The versions the content comes from, lowest scope first: one for a text file. */
  layers: InstructionLayer[];
}

export interface ResolvedInstructions {
  files: ResolvedInstruction[];
  /** Broken JSON layers or fields that fell back to the layer below. */
  warnings: Reason[];
}

/** Whether a version applies to a run of this repository at this level. */
export function instructionApplies(
  layer: Pick<InstructionLayer, 'scope' | 'repositoryId' | 'level'>,
  target: InstructionTarget,
): boolean {
  switch (layer.scope) {
    case 'global':
      return true;
    case 'repository':
      return layer.repositoryId === target.repositoryId;
    case 'level':
      return layer.level === target.level;
  }
}

/**
 * `resolveInstructions(repo, level)`: per file key, the level copy beats the repository copy,
 * which beats the global file. Another repository's copies and other levels' copies never apply.
 * A JSON file merges its layers field by field, so a broken field falls back with a warning
 * instead of stopping the review (config resilience).
 */
export function resolveInstructions(
  layers: readonly InstructionLayer[],
  target: InstructionTarget,
): ResolvedInstructions {
  const byKey = new Map<string, InstructionLayer[]>();
  for (const layer of layers) {
    if (!instructionApplies(layer, target)) continue;
    byKey.set(layer.fileKey, [...(byKey.get(layer.fileKey) ?? []), layer]);
  }
  const warnings: Reason[] = [];
  const files: ResolvedInstruction[] = [];
  for (const key of [...byKey.keys()].sort()) {
    const ordered = byKey.get(key)!.sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);
    if (key.endsWith('.json')) {
      files.push(mergeJsonLayers(key, ordered, warnings));
    } else {
      const top = ordered.at(-1)!;
      files.push({ fileKey: key, content: top.content, layers: [top] });
    }
  }
  return { files, warnings };
}

function mergeJsonLayers(
  fileKey: string,
  layers: InstructionLayer[],
  warnings: Reason[],
): ResolvedInstruction {
  let merged: unknown;
  const used: InstructionLayer[] = [];
  for (const layer of layers) {
    const where = { fileKey, scope: layer.scope, version: layer.version };
    let parsed: unknown;
    try {
      parsed = JSON.parse(layer.content);
    } catch {
      warnings.push(reason('instruction_json_invalid', where));
      continue;
    }
    if (!used.length) {
      merged = parsed;
    } else if (isObject(merged) && isObject(parsed)) {
      merged = mergeFields(merged, parsed, '', (field) =>
        warnings.push(reason('instruction_field_invalid', { ...where, field })),
      );
    } else if (jsonType(merged) === jsonType(parsed)) {
      merged = parsed;
    } else {
      warnings.push(reason('instruction_json_invalid', where));
      continue;
    }
    used.push(layer);
  }
  if (!used.length) {
    // Nothing parses: the agent gets the most specific text as it is.
    const top = layers.at(-1)!;
    return { fileKey, content: top.content, layers: [top] };
  }
  const content = used.length === 1 ? used[0]!.content : `${JSON.stringify(merged, null, 2)}\n`;
  return { fileKey, content, layers: used };
}

type JsonObject = Record<string, unknown>;

function mergeFields(
  lower: JsonObject,
  upper: JsonObject,
  path: string,
  broken: (field: string) => void,
): JsonObject {
  const out: JsonObject = { ...lower };
  for (const [key, value] of Object.entries(upper)) {
    const field = path ? `${path}.${key}` : key;
    const below = lower[key];
    if (!(key in lower) || below === null) {
      out[key] = value;
    } else if (isObject(below) && isObject(value)) {
      out[key] = mergeFields(below, value, field, broken);
    } else if (jsonType(below) !== jsonType(value)) {
      broken(field);
    } else {
      out[key] = value;
    }
  }
  return out;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function jsonType(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

/** One line of a line diff. */
export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Lines of a text; a final newline does not add an empty line. */
function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** The most cells of the longest-common-subsequence table (16 MB): about 2,000 × 2,000 lines. */
export const MAX_LCS_CELLS = 4_000_000;

/** The line diff (longest common subsequence) from `before` to `after`. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  // The table has (n + 1) × (m + 1) cells: past the cap the changed middle reads as replaced, so a
  // large file never blocks the API for seconds or fails the allocation.
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    return [
      ...a.slice(0, start).map((text): DiffLine => ({ kind: 'same', text })),
      ...midA.map((text): DiffLine => ({ kind: 'removed', text })),
      ...midB.map((text): DiffLine => ({ kind: 'added', text })),
      ...a.slice(endA).map((text): DiffLine => ({ kind: 'same', text })),
    ];
  }
  // lcs[i * (m + 1) + j]: common lines of midA[i..] and midB[j..].
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }
  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      out.push({ kind: 'same', text: midA[i]! });
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1]! >= lcs[(i + 1) * (m + 1) + j]!)) {
      out.push({ kind: 'added', text: midB[j]! });
      j++;
    } else {
      out.push({ kind: 'removed', text: midA[i]! });
      i++;
    }
  }
  for (const text of a.slice(endA)) out.push({ kind: 'same', text });
  return out;
}

/** Added and removed line counts of a diff. */
export function diffSummary(lines: readonly DiffLine[]): { added: number; removed: number } {
  return {
    added: lines.filter((l) => l.kind === 'added').length,
    removed: lines.filter((l) => l.kind === 'removed').length,
  };
}

/**
 * Instruction files a stage cannot run without (INSTR): a missing or empty one fails the stage, so
 * a run checks them before its first stage. The reviewer's prompt has a built-in fallback
 * (`BUILT_IN_REVIEWER_PROMPT`) and the judge is skipped without its files, so neither is listed.
 */
export const REQUIRED_INSTRUCTION_FILES = {
  verify: ['prompt-verifier.md', 'verify-rules.md'],
  implement: ['prompt-implementer.md', 'implement-rules.md'],
  analyse: ['prompt-analyst.md', 'analyst-rules.md'],
} as const satisfies Readonly<Record<string, readonly string[]>>;
export type InstructionStage = keyof typeof REQUIRED_INSTRUCTION_FILES;

const INSTRUCTION_STAGES = Object.keys(REQUIRED_INSTRUCTION_FILES) as InstructionStage[];

export const isInstructionStage = (stage: string): stage is InstructionStage =>
  (INSTRUCTION_STAGES as string[]).includes(stage);

/** One stage's required files that are missing or empty. */
export interface InstructionGap {
  stage: InstructionStage;
  missing: string[];
}

/** The required files of `stages` that `files` lacks or holds empty, in `stages` order. */
export function missingInstructions(
  files: ReadonlyMap<string, string>,
  stages: readonly string[],
): InstructionGap[] {
  const gaps: InstructionGap[] = [];
  for (const stage of stages) {
    if (!isInstructionStage(stage)) continue;
    const missing = REQUIRED_INSTRUCTION_FILES[stage].filter((key) => !files.get(key)?.trim());
    if (missing.length) gaps.push({ stage, missing });
  }
  return gaps;
}

/** The stages with required files that run at a level: Verify in its rounds, then the features. */
export function instructionStagesAt(level: LevelNumber): InstructionStage[] {
  const from: Record<InstructionStage, LevelNumber> = {
    verify: STAGE_ON_FROM.verify,
    implement: FEATURE_ON_FROM.implement,
    analyse: FEATURE_ON_FROM.learning,
  };
  return INSTRUCTION_STAGES.filter((stage) => level >= from[stage]);
}

/** A gap at one level of one repository. */
export interface LevelInstructionGap extends InstructionGap {
  level: LevelNumber;
}

/**
 * Per level, the required files a run of this repository would miss, from the active versions
 * (`layers`, as `resolveInstructions` reads them). Empty when nothing is missing.
 */
export function instructionGaps(
  layers: readonly InstructionLayer[],
  repositoryId: number,
): LevelInstructionGap[] {
  return LEVEL_NUMBERS.flatMap((level) => {
    const { files } = resolveInstructions(layers, { repositoryId, level });
    const byKey = new Map(files.map((f) => [f.fileKey, f.content]));
    return missingInstructions(byKey, instructionStagesAt(level)).map((gap) => ({
      ...gap,
      level,
    }));
  });
}

/**
 * The reviewer prompt used since S-01 when no usable `prompt-reviewer.md` is stored. It is also
 * the global version 1 that `pnpm instructions:import` creates, so a repository without its own
 * copy gets no rules written for another repository.
 */
export const BUILT_IN_REVIEWER_PROMPT = [
  'Review the pull request. First read the rules: {{knowledgeDir}}/review-rules.md.',
  'Then read brief.md and diff.patch in the current directory.',
  'The repository at the PR head: {{repoDir}}. The knowledge directory: {{knowledgeDir}}.',
].join(' ');
