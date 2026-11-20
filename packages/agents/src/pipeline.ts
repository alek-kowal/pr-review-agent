// The pipeline descriptor (S-22-T9): what each stage is, built from code. `GET /api/pipeline` adds
// the models (core `modelFor`), the timeout (the level's settings) and the instruction files each
// slot reads (STAGEFILES); Settings → Pipeline draws it and edits the slots' files only.
import {
  ALL_MARKDOWN_DOCUMENTS,
  FEATURE_ON_FROM,
  REQUIRED_INSTRUCTION_FILES,
  resolveStageFiles,
  STAGE_ON_FROM,
  type AgentRole,
  type FileStageKey,
  type FrozenStageFiles,
  type LevelNumber,
  type StageFileChoices,
  type StageSlotDecl,
} from '@pra/core';
import { AnalystAnswerSchema } from './analyst/analyst.ts';
import { ROLE_TOOLS } from './claude-agent-runner.ts';
import { ImplementerAnswerSchema } from './implementer/implementer.ts';
import { JudgeAnswerSchema } from './judge/judge.ts';
import { FixCheckAnswerSchema } from './reviewer/fix-check.ts';
import { VerifierAnswerSchema } from './verifier/verifier.ts';

export const PIPELINE_STAGE_KEYS = [
  'checks',
  'task',
  'change_type',
  'review',
  'verify',
  'implement',
  'fix_check',
  'analyst',
] as const;
export type PipelineStageKey = (typeof PIPELINE_STAGE_KEYS)[number];

/** The services behind `@pra/integrations` interfaces that a stage calls itself. */
export type PipelineIntegration = 'GitHubGateway' | 'GitMirror' | 'Sandbox' | 'ClickUpGateway';

export interface PipelineStage {
  key: PipelineStageKey;
  /** The agent role it runs; null for a stage of plain code. */
  role: AgentRole | null;
  /** The agent's built-in tools (`ROLE_TOOLS`); empty for code and for the tool-less judge. */
  tools: readonly string[];
  /** Services the stage itself calls, outside the agent. */
  integrations: readonly PipelineIntegration[];
  /**
   * The instruction files the stage reads, by slot, with today's keys as defaults; a choice in
   * Settings → Pipeline picks other files (core `resolveStageFiles`). Empty for a stage that reads
   * none.
   */
  slots: readonly StageSlotDecl[];
  /** The stage's output: its schema's name and top-level fields. */
  output: { schema: string; fields: readonly string[] };
  /** Automatic attempts. A failed stage stops the run; Retry is a button (S-15). */
  attempts: number;
  /** Automatic repairs inside the stage, for example a reproduction script that broke. */
  repairs: number;
  /** The level from which the stage runs. */
  onFrom: LevelNumber;
}

const fieldsOf = (schema: { shape: object }) => Object.keys(schema.shape);
const toolsOf = (role: AgentRole) => ROLE_TOOLS[role] ?? [];

/** A required prompt and rules slot pair from core `REQUIRED_INSTRUCTION_FILES`. */
const requiredSlots = ([prompt, rules]: readonly [string, string]): StageSlotDecl[] => [
  { name: 'prompt', kind: 'instruction', default: prompt, required: true },
  { name: 'rules', kind: 'instruction', default: rules, required: true },
];

/**
 * Every stage, in pipeline order: the round's stages (core `STAGE_KEYS`), then Implement and Fix
 * check from level 4 and the Analyst after a level 6 PR closes.
 */
export const PIPELINE_STAGES: readonly PipelineStage[] = Object.freeze([
  {
    key: 'checks',
    role: null,
    tools: [],
    integrations: ['GitHubGateway', 'GitMirror', 'Sandbox'],
    slots: [],
    output: { schema: 'ChecksOutput', fields: ['ci', 'install'] },
    attempts: 1,
    repairs: 0,
    onFrom: STAGE_ON_FROM.checks,
  },
  {
    key: 'task',
    role: null,
    tools: [],
    integrations: ['ClickUpGateway'],
    slots: [],
    output: { schema: 'TaskOutput', fields: ['status', 'how', 'task'] },
    attempts: 1,
    repairs: 0,
    onFrom: STAGE_ON_FROM.task,
  },
  {
    key: 'change_type',
    role: 'judge',
    tools: [],
    integrations: [],
    // Optional: the stage is skipped without them.
    slots: [
      { name: 'prompt', kind: 'instruction', default: 'prompt-classifier.md' },
      { name: 'rules', kind: 'instruction', default: 'classify-rules.md' },
    ],
    output: { schema: 'JudgeAnswer', fields: fieldsOf(JudgeAnswerSchema) },
    attempts: 1,
    repairs: 0,
    onFrom: STAGE_ON_FROM.change_type,
  },
  {
    key: 'review',
    role: 'reviewer',
    tools: toolsOf('reviewer'),
    integrations: ['GitMirror'],
    // Without a prompt file it uses the built-in one; its knowledge folder holds the rules (as
    // `review-rules.md`) and the documents.
    slots: [
      { name: 'prompt', kind: 'instruction', default: 'prompt-reviewer.md', builtIn: true },
      { name: 'rules', kind: 'instruction', default: 'review-rules.md' },
      { name: 'documents', kind: 'document', default: ALL_MARKDOWN_DOCUMENTS },
    ],
    output: {
      schema: 'ReviewOutput',
      fields: ['summary', 'risk', 'findings', 'gatedNotes', 'questions', 'notChecked', 'fixes'],
    },
    attempts: 1,
    repairs: 0,
    onFrom: STAGE_ON_FROM.review,
  },
  {
    key: 'verify',
    role: 'verifier',
    tools: toolsOf('verifier'),
    integrations: ['GitMirror', 'Sandbox'],
    slots: requiredSlots(REQUIRED_INSTRUCTION_FILES.verify),
    output: { schema: 'VerifierAnswer', fields: fieldsOf(VerifierAnswerSchema) },
    attempts: 1,
    repairs: 1,
    onFrom: STAGE_ON_FROM.verify,
  },
  {
    key: 'implement',
    role: 'implementer',
    tools: toolsOf('implementer'),
    integrations: ['GitMirror'],
    slots: requiredSlots(REQUIRED_INSTRUCTION_FILES.implement),
    output: { schema: 'ImplementerAnswer', fields: fieldsOf(ImplementerAnswerSchema) },
    attempts: 1,
    repairs: 0,
    onFrom: FEATURE_ON_FROM.implement,
  },
  {
    key: 'fix_check',
    role: 'reviewer',
    tools: toolsOf('reviewer'),
    integrations: ['GitMirror'],
    // Its prompt is built in (`FIX_CHECK_PROMPT`).
    slots: [],
    output: { schema: 'FixCheckAnswer', fields: fieldsOf(FixCheckAnswerSchema) },
    attempts: 1,
    repairs: 0,
    onFrom: FEATURE_ON_FROM.implement,
  },
  {
    key: 'analyst',
    role: 'analyst',
    tools: toolsOf('analyst'),
    integrations: [],
    // The v1 prompt names the rules and `lessons.md` (rendered as `knowledge/<key>`).
    slots: [
      ...requiredSlots(REQUIRED_INSTRUCTION_FILES.analyse),
      { name: 'documents', kind: 'document', default: ['lessons.md'] },
    ],
    output: { schema: 'AnalystAnswer', fields: fieldsOf(AnalystAnswerSchema) },
    attempts: 1,
    repairs: 0,
    onFrom: FEATURE_ON_FROM.learning,
  },
] satisfies PipelineStage[]);

/** The slots of a stage that reads instruction files. */
export function slotsOf(stage: FileStageKey): readonly StageSlotDecl[] {
  return PIPELINE_STAGES.find((s) => s.key === stage)?.slots ?? [];
}

const SLOTS_BY_STAGE = Object.fromEntries(
  PIPELINE_STAGES.filter((s) => s.slots.length).map((s) => [s.key, s.slots]),
) as Partial<Record<FileStageKey, readonly StageSlotDecl[]>>;

/**
 * Every stage's files for one target: `choices` from `stageFileChoicesOf`, `documentKeys` the
 * document keys the target resolves (what the reviewer's default "all Markdown" expands to).
 */
export function stageFilesFor(
  choices: StageFileChoices,
  documentKeys: readonly string[],
): FrozenStageFiles {
  return resolveStageFiles(SLOTS_BY_STAGE, choices, documentKeys);
}
