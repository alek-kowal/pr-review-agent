// The pipeline descriptor (S-22-T9): what each stage is, built from code. `GET /api/pipeline` adds
// the models (core `modelFor`), the timeout (the level's settings) and the active instruction
// versions; Settings → Pipeline draws it read-only.
import { FEATURE_ON_FROM, STAGE_ON_FROM, type AgentRole, type LevelNumber } from '@pra/core';
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
  /** Instruction file keys the stage reads, the prompt first. */
  instructionFiles: readonly string[];
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

/** Instruction files the reviewer reads; every active file is also in its knowledge folder. */
export const REVIEW_INSTRUCTION_FILES = [
  'prompt-reviewer.md',
  'review-rules.md',
  'lessons.md',
  'repo-knowledge.md',
] as const;

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
    instructionFiles: [],
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
    instructionFiles: [],
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
    instructionFiles: ['prompt-classifier.md', 'classify-rules.md'],
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
    instructionFiles: REVIEW_INSTRUCTION_FILES,
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
    instructionFiles: ['prompt-verifier.md', 'verify-rules.md'],
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
    instructionFiles: ['prompt-implementer.md', 'implement-rules.md'],
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
    instructionFiles: [],
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
    // P-21 (S-23) builds the analyst and names its instruction files.
    instructionFiles: [],
    output: { schema: 'LessonCandidates', fields: ['candidates'] },
    attempts: 1,
    repairs: 0,
    onFrom: FEATURE_ON_FROM.learning,
  },
] satisfies PipelineStage[]);
