// What a stage executor gets and returns. The `run.stage` handler (src/run/execute-stage.ts)
// writes the result; executors only read and compute.
import type { AgentRunResult, FixStatus } from '@pra/agents';
import type { AgentRole, FrozenLevel, Severity, StageErrorCode } from '@pra/core';
import type { PullRequest, Repository, Run } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';

export type StageContext = {
  deps: WorkerDeps;
  run: Run;
  pullRequest: PullRequest;
  repository: Repository;
  /** The run's frozen level. */
  level: FrozenLevel;
  /** 1 for the first attempt of this stage in this run. */
  attempt: number;
  /** Aborted on the stage timeout (and, later, on cancel). */
  signal: AbortSignal;
};

/** One agent session of a stage, as the handler stores it (`agent_sessions` and blobs). */
export type SessionRecord = {
  role: AgentRole;
  model: string;
  /** The text the session was started with (stored as the prompt blob). */
  prompt: string;
  result: AgentRunResult<unknown>;
};

export type StageFinding = {
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
  suggestion: string;
};

export type StageQuestion = {
  text: string;
  options: string[];
  recommended: number | null;
  why: string | null;
};

/** A code from core `STAGE_ERROR_CODES` only: the web has copy for each of them. */
export type StageError = { code: StageErrorCode; params: Record<string, unknown> };

export type StageResult =
  | {
      status: 'succeeded';
      /** Stored as the stage's `output` (JSON). */
      output: unknown;
      sessions: SessionRecord[];
      findings: StageFinding[];
      questions: StageQuestion[];
      /** What the reviewer says it did not check; stored on the run. */
      notChecked: string[];
      /** Resolved / Not resolved per finding decided Implement (S-07-T3); replaces this round's. */
      fixChecks?: FixStatus[];
    }
  | { status: 'failed'; error: StageError; sessions: SessionRecord[]; output?: unknown };

export type StageExecutor = {
  /** The stage key in the run plan (core `stagesFor`). */
  key: string;
  /** Agent stages pass the `beforeSession` gates first. */
  usesAgent: boolean;
  run: (context: StageContext) => Promise<StageResult>;
};
