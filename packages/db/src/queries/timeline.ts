// S-03-T5: the PR timeline and the PR state-change log. Every writer goes through
// `recordTimelineEntry` and `recordStateChange`; later slices add their entries the same way.
import {
  chainState,
  laneOf,
  prState,
  type Actor,
  type ActiveRun,
  type FailedRound,
  type Finding,
  type PrStateInput,
  type RunRecord,
  type StageKey,
} from '@pra/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { findings, questions, runs, stageExecutions } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';
import { prStateChanges, timelineEntries } from '../schema/timeline.ts';
import { currentDecisions, type Transactor } from './decisions.ts';
import { readRepositoryConfig } from './repositories.ts';
import type { Run } from './runs.ts';

export type TimelineEntry = typeof timelineEntries.$inferSelect;
export type PrStateChange = typeof prStateChanges.$inferSelect;

export type NewTimelineEntry = {
  pullRequestId: number;
  actor: Actor;
  /** For example `pr_ready`, `round_started`, `round_finished`, `findings_decided`. */
  kind: string;
  params?: Record<string, unknown>;
  runId?: number | null;
  costUsd?: number | null;
  /** When it happened; defaults to now. */
  at?: Date;
  /** Unique per PR: the event, run or batch the entry comes from. */
  sourceKey: string;
};

/** Adds one entry; a second write with the same `sourceKey` does nothing. Returns the new row. */
export async function recordTimelineEntry(
  db: Executor,
  entry: NewTimelineEntry,
): Promise<TimelineEntry | null> {
  const [row] = await db
    .insert(timelineEntries)
    .values({
      pullRequestId: entry.pullRequestId,
      actor: entry.actor.kind,
      memberId: entry.actor.kind === 'member' ? entry.actor.memberId : null,
      kind: entry.kind,
      params: entry.params ?? {},
      runId: entry.runId ?? null,
      costUsd: entry.costUsd ?? null,
      ...(entry.at ? { at: entry.at } : {}),
      sourceKey: entry.sourceKey,
    })
    .onConflictDoNothing({ target: [timelineEntries.pullRequestId, timelineEntries.sourceKey] })
    .returning();
  return row ?? null;
}

/** A run's starter as a core actor. */
export const runActor = (run: Pick<Run, 'startedBy' | 'startedByMemberId'>): Actor =>
  run.startedBy === 'member'
    ? { kind: 'member', memberId: run.startedByMemberId! }
    : { kind: run.startedBy };

/**
 * Computes the PR's state with core `prState` and logs it when it differs from the last logged
 * state. The PR row is locked, so two writers never log the same change twice. Returns the new
 * row, or null when the state did not change.
 */
export async function recordStateChange(
  db: Transactor,
  pullRequestId: number,
  reason: { code: string; params?: Record<string, unknown> },
  options: { at?: Date } = {},
): Promise<PrStateChange | null> {
  return db.transaction(async (tx) => {
    const [pr] = await tx
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.id, pullRequestId))
      .for('update');
    if (!pr) return null;
    const input = await loadStateInput(tx, pr);
    if (!input) return null;
    const state = prState(input);
    const [last] = await tx
      .select({ state: prStateChanges.state })
      .from(prStateChanges)
      .where(eq(prStateChanges.pullRequestId, pullRequestId))
      .orderBy(desc(prStateChanges.at), desc(prStateChanges.id))
      .limit(1);
    if (last?.state === state) return null;
    const [row] = await tx
      .insert(prStateChanges)
      .values({
        pullRequestId,
        state,
        lane: laneOf(state),
        reason: { code: reason.code, params: reason.params ?? {} },
        headSha: pr.headSha,
        ...(options.at ? { at: options.at } : {}),
      })
      .returning();
    return row!;
  });
}

export type TimelineRow = TimelineEntry & { memberName: string | null };

/** The PR's timeline, oldest first, with the signing member's name. */
export async function timelineOf(db: Executor, pullRequestId: number): Promise<TimelineRow[]> {
  const rows = await db
    .select({ entry: timelineEntries, memberName: teamMembers.name })
    .from(timelineEntries)
    .leftJoin(teamMembers, eq(teamMembers.id, timelineEntries.memberId))
    .where(eq(timelineEntries.pullRequestId, pullRequestId))
    .orderBy(asc(timelineEntries.at), asc(timelineEntries.id));
  return rows.map((row) => ({ ...row.entry, memberName: row.memberName }));
}

/** The PR's logged states, oldest first. */
export async function stateChangesOf(
  db: Executor,
  pullRequestId: number,
): Promise<PrStateChange[]> {
  return db
    .select()
    .from(prStateChanges)
    .where(eq(prStateChanges.pullRequestId, pullRequestId))
    .orderBy(asc(prStateChanges.at), asc(prStateChanges.id));
}

const BLOCKING = ['round', 'implementer'];
const roundKindOf = (run: Pick<Run, 'roundNo'>) =>
  (run.roundNo ?? 1) > 1 ? ('fix_check' as const) : ('full' as const);

/**
 * The state table's input from stored rows. Private on purpose: P-08's `loadPrStateInput`
 * replaces it after merge. Fields this branch does not store yet (CI, patches, sensitive files,
 * answers, reviewers) are empty.
 */
async function loadStateInput(
  tx: Executor,
  pr: typeof pullRequests.$inferSelect,
): Promise<PrStateInput | null> {
  const [repository] = await tx
    .select()
    .from(repositories)
    .where(eq(repositories.id, pr.repositoryId));
  if (!repository) return null;
  const prRuns = await tx
    .select()
    .from(runs)
    .where(eq(runs.pullRequestId, pr.id))
    .orderBy(asc(runs.createdAt), asc(runs.id));

  const active = prRuns.findLast(
    (run) => BLOCKING.includes(run.kind) && (run.status === 'queued' || run.status === 'running'),
  );
  const rounds = prRuns.filter((run) => run.kind === 'round');
  const reviewed = rounds.findLast((run) => run.status === 'completed') ?? null;
  const lastRound = rounds.findLast((run) => run.status !== 'queued' && run.status !== 'running');
  const chain = chainState(prRuns.map(toRunRecord));

  let failedRound: FailedRound | null = null;
  if (lastRound?.status === 'failed') {
    const [failedStage] = await tx
      .select()
      .from(stageExecutions)
      .where(and(eq(stageExecutions.runId, lastRound.id), eq(stageExecutions.status, 'failed')))
      .orderBy(desc(stageExecutions.id))
      .limit(1);
    failedRound = {
      stage: (failedStage?.stage ?? 'review') as StageKey,
      errorCode: failedStage?.errorCode ?? 'stage_error',
      roundNumber: lastRound.roundNo ?? 1,
      timeoutMinutes: null,
    };
  }

  const findingRows = reviewed
    ? await tx
        .select()
        .from(findings)
        .where(eq(findings.runId, reviewed.id))
        .orderBy(asc(findings.ordinal))
    : [];
  const decisions = await currentDecisions(
    tx,
    findingRows.map((row) => row.id),
  );
  const questionRows = reviewed
    ? await tx.select({ id: questions.id }).from(questions).where(eq(questions.runId, reviewed.id))
    : [];

  const activeRun: ActiveRun | null = active
    ? {
        kind: active.kind,
        status: active.status as 'queued' | 'running',
        roundKind: active.kind === 'round' ? roundKindOf(active) : null,
        trigger: active.trigger as ActiveRun['trigger'],
        startedBy: runActor(active),
        roundNumber: active.roundNo,
        fixSha: null,
        retryFrom: null,
        queue: null,
      }
    : null;

  return {
    state: pr.state,
    closedBy: null,
    draft: pr.isDraft,
    fork: pr.isFork,
    author: pr.authorLogin,
    level: readRepositoryConfig(repository).value.defaultLevel,
    headSha: pr.headSha,
    reviewedSha: reviewed?.headSha ?? null,
    commitsSinceReview: reviewed
      ? Math.max(
          pr.commitsCount - reviewed.commitsCountAtStart,
          reviewed.headSha === pr.headSha ? 0 : 1,
        )
      : 0,
    changeType: null,
    activeRun,
    failedRound,
    chainRounds: chain.completedRounds,
    findings: findingRows.map((row): Finding => ({
      id: String(row.id),
      severity: row.severity,
      title: row.title,
      file: row.file,
      line: row.line,
      scenario: row.scenario,
      suggestion: row.suggestion,
      remedy: null,
      verdict: row.verdict,
      evidence: row.evidence,
      decision: decisions.get(row.id)?.decision ?? null,
      resolved: null,
    })),
    // Answers arrive with S-14; until then every question of the reviewed round is open.
    questions: questionRows.map((row) => ({ id: String(row.id), answered: false })),
    sensitive: null,
    patch: null,
    reviewers: 0,
    ci: [],
    changesRequestedBy: [],
  };
}

function toRunRecord(run: Run): RunRecord {
  return {
    id: String(run.id),
    kind: run.kind,
    status: run.status,
    trigger: run.trigger as RunRecord['trigger'],
    startedBy: runActor(run),
    sha: run.headSha,
    fixSha: null,
    level: run.level.number,
  };
}
