import {
  ACTOR_KINDS,
  AGENT_ROLES,
  RUN_KINDS,
  SEVERITIES,
  VERDICTS,
  type Evidence,
  type Remedy,
  type FrozenLevel,
  type RunStatus,
  type StageStatus,
} from '@pra/core';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';

export const RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly RunStatus[];
export const ACTIVE_RUN_STATUSES = ['queued', 'running'] as const satisfies readonly RunStatus[];
/** Run kinds that hold a PR: trials and the analyst run next to them. */
export const BLOCKING_RUN_KINDS = ['round', 'implementer'] as const;

export const STAGE_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'off',
  'reused',
] as const satisfies readonly StageStatus[];

/** Why a run was cancelled (S-09): by hand from the app, or because its PR closed. */
export const CANCEL_REASONS = ['by_hand', 'pr_closed'] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const COST_SOURCES = ['reported', 'computed'] as const;
export type CostSource = (typeof COST_SOURCES)[number];

const usd = (name: string) =>
  numeric(name, { precision: 12, scale: 6, mode: 'number' }).notNull().default(0);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} in (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;

/** One active instruction file version, as a run recorded it. */
export type RunInstructionVersion = {
  id: number;
  scope: 'global' | 'repository';
  fileKey: string;
  version: number;
};

/** One run on a PR: a review round, an implementer run, a trial or the analyst. */
export const runs = pgTable(
  'runs',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    kind: text({ enum: RUN_KINDS }).notNull(),
    /** Round number in its chain (1 to 3); null for runs that are not rounds. */
    roundNo: integer('round_no'),
    chainId: uuid('chain_id'),
    /** Core `FrozenLevel`: the level as it was when the run was created. */
    level: jsonb().$type<FrozenLevel>().notNull(),
    headSha: text('head_sha').notNull(),
    commitsCountAtStart: integer('commits_count_at_start').notNull(),
    status: text({ enum: RUN_STATUSES }).notNull().default('queued'),
    /** `bot`, `hand` (unsigned) or `member` with `started_by_member_id`. */
    startedBy: text('started_by', { enum: ACTOR_KINDS }).notNull(),
    startedByMemberId: text('started_by_member_id'),
    /** Why the run started, as a reason code (`ready_for_review`, `manual`, `own_fix`, ...). */
    trigger: text().notNull(),
    createdAt: createdAt(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** Sum of the run's agent session costs; grows per turn while a session runs. */
    costUsd: usd('cost_usd'),
    /** The stage running now, or the next one between two stages; null when not running. */
    currentStage: text('current_stage'),
    /** Instruction files the run read, set when it starts (Run detail). */
    instructionVersions: jsonb('instruction_versions')
      .$type<RunInstructionVersion[]>()
      .notNull()
      .default([]),
    /** Commits between `head_sha` and the PR head `commits_since_head` (S-07, FR-020). */
    commitsSince: integer('commits_since'),
    commitsSinceHead: text('commits_since_head'),
    /** What the reviewer says it did not check. */
    notChecked: text('not_checked')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The failed run this run retries (S-09-T1): same chain, round, level and head. */
    retryOf: integer('retry_of').references((): AnyPgColumn => runs.id),
    /** The stage a retry starts from (the failed run's failed stage). */
    retryFrom: text('retry_from'),
    /**
     * A cancel was asked for (S-09-T3); the run stays queued or running until the worker has
     * stopped its work and set `cancelled`. Who asked and why stay for the timeline.
     */
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by', { enum: ACTOR_KINDS }),
    cancelledByMemberId: text('cancelled_by_member_id'),
    cancelReason: text('cancel_reason', { enum: CANCEL_REASONS }),
  },
  (t) => [
    uniqueIndex('runs_one_active_per_pr')
      .on(t.pullRequestId)
      .where(
        sql`${inList(t.status, ACTIVE_RUN_STATUSES)} and ${inList(t.kind, BLOCKING_RUN_KINDS)}`,
      ),
    index('runs_pull_request').on(t.pullRequestId, t.createdAt),
    check('runs_kind', inList(t.kind, RUN_KINDS)),
    check('runs_status', inList(t.status, RUN_STATUSES)),
    check('runs_started_by', inList(t.startedBy, ACTOR_KINDS)),
    check('runs_cancelled_by', inList(t.cancelledBy, ACTOR_KINDS)),
    check('runs_cancel_reason', inList(t.cancelReason, CANCEL_REASONS)),
    check(
      'runs_started_by_member',
      sql`(${t.startedBy} = 'member') = (${t.startedByMemberId} is not null)`,
    ),
  ],
);

/** One attempt at one stage of a run. A retry adds a new attempt. */
export const stageExecutions = pgTable(
  'stage_executions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    stage: text().notNull(),
    attempt: integer().notNull().default(1),
    status: text({ enum: STAGE_STATUSES }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    output: jsonb().$type<unknown>(),
    errorCode: text('error_code'),
    errorDetail: text('error_detail'),
    /** A retry's copy of a stage the failed run finished (`reused`), and where it came from. */
    reusedFromStageId: integer('reused_from_stage_id').references(
      (): AnyPgColumn => stageExecutions.id,
    ),
  },
  (t) => [
    unique('stage_executions_run_stage_attempt').on(t.runId, t.stage, t.attempt),
    check('stage_executions_status', inList(t.status, STAGE_STATUSES)),
  ],
);

/** One agent session inside a stage, with its tokens, real cost and stored transcript. */
export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    stageExecutionId: integer('stage_execution_id')
      .notNull()
      .references(() => stageExecutions.id, { onDelete: 'cascade' }),
    role: text({ enum: AGENT_ROLES }).notNull(),
    model: text().notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: usd('cost_usd'),
    /** `reported` by the SDK's result, or `computed` from streamed usage when it stopped early. */
    costSource: text('cost_source', { enum: COST_SOURCES }).notNull(),
    turns: integer().notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    status: text().notNull(),
    promptBlobKey: text('prompt_blob_key'),
    transcriptBlobKey: text('transcript_blob_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('agent_sessions_stage_execution').on(t.stageExecutionId),
    check('agent_sessions_role', inList(t.role, AGENT_ROLES)),
    check('agent_sessions_cost_source', inList(t.costSource, COST_SOURCES)),
  ],
);

/** A finding a round reported, in the order the round ranked it. */
export const findings = pgTable(
  'findings',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    ordinal: integer().notNull(),
    severity: text({ enum: SEVERITIES }).notNull(),
    title: text().notNull(),
    file: text().notNull(),
    line: integer(),
    scenario: text().notNull(),
    suggestion: text().notNull(),
    verdict: text({ enum: VERDICTS }).notNull().default('unchecked'),
    evidence: jsonb().$type<Evidence[]>().notNull().default([]),
    /** Bumped on every change, for optimistic concurrency of decisions. */
    version: integer().notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('findings_run_ordinal').on(t.runId, t.ordinal),
    index('findings_pull_request').on(t.pullRequestId),
    check('findings_severity', inList(t.severity, SEVERITIES)),
    check('findings_verdict', inList(t.verdict, VERDICTS)),
  ],
);

/**
 * How the Verify stage reached a finding's verdict: one row per verified (or skipped) finding of
 * a level-3 round. The verdict and kept quotes also sit on `findings`; this keeps the rest.
 */
export const findingVerifications = pgTable(
  'finding_verifications',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    verdict: text({ enum: VERDICTS }).notNull(),
    /** Core reason code for the verdict (quotes, reproduction, or the change type's scope). */
    reason: jsonb().$type<{ code: string; params: Record<string, unknown> }>().notNull(),
    /** The verifier's own verdict and words; null when the finding was skipped. */
    verifierVerdict: text('verifier_verdict', { enum: VERDICTS }),
    verifierReason: text('verifier_reason'),
    /** Quotes not found word for word in the file at the reviewed SHA. */
    droppedQuotes: jsonb('dropped_quotes').$type<Evidence[]>().notNull().default([]),
    remedy: jsonb().$type<{ kind: Remedy; why: string }>(),
    /** The reproduction that decided (the repaired one when repaired); null when none ran. */
    script: text(),
    exitCode: integer('exit_code'),
    timedOut: boolean('timed_out').notNull().default(false),
    outputTail: text('output_tail'),
    /** The whole output in BlobStore. */
    outputBlobKey: text('output_blob_key'),
    repaired: boolean().notNull().default(false),
    sandboxRuns: integer('sandbox_runs').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique('finding_verifications_finding').on(t.findingId),
    index('finding_verifications_run').on(t.runId),
    check('finding_verifications_verdict', inList(t.verdict, VERDICTS)),
  ],
);

/** A question a round asks the team, with 2–3 options and the one it recommends. */
export const questions = pgTable(
  'questions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    ordinal: integer().notNull(),
    text: text().notNull(),
    options: jsonb().$type<string[]>().notNull(),
    /** Index into `options`. */
    recommended: integer(),
    /** Why the reviewer recommends that option. */
    why: text(),
    createdAt: createdAt(),
  },
  (t) => [unique('questions_run_ordinal').on(t.runId, t.ordinal)],
);

/** Everything the app wrote to GitHub, with GitHub's answer. */
export const githubActions = pgTable(
  'github_actions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    runId: integer('run_id').references(() => runs.id, { onDelete: 'set null' }),
    /** For example `comment`. */
    kind: text().notNull(),
    body: text().notNull(),
    /** Outcome code, for example `posted` or `failed`. */
    result: text().notNull(),
    githubId: bigint('github_id', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [index('github_actions_pull_request').on(t.pullRequestId)],
);
