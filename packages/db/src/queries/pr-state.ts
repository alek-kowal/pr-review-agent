// Builds core's `PrStateInput` from the database, for the board and the PR page. Reads only.
import {
  chainState,
  member,
  BOT,
  HAND,
  type ActiveRun,
  type Actor,
  type FailedRound,
  type Finding,
  type LevelNumber,
  type PrStateInput,
  type RoundTrigger,
  type RunRecord,
  type StageKey,
} from '@pra/core';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { findings, questions, runs, stageExecutions } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';
import { currentDecisions, type CurrentDecision } from './decisions.ts';
import { readRepositoryConfig, type PullRequest, type Repository } from './repositories.ts';
import type { FindingRow, QuestionRow, Run } from './runs.ts';
import type { TeamMember } from './team.ts';

/** Run kinds that change a PR's state; trials and the analyst never do. */
const STATE_RUN_KINDS = ['round', 'implementer'] as const;

const ROUND_TRIGGERS: readonly RoundTrigger[] = ['ready_for_review', 'manual', 'own_fix'];

export type PrStateLoad = {
  repository: Repository;
  pullRequest: PullRequest;
  input: PrStateInput;
  /** The Team member whose GitHub login is the PR author's; null when none is. */
  authorMember: TeamMember | null;
  /** The completed round the findings and questions come from; null before one completed. */
  reviewedRound: Run | null;
  findings: FindingRow[];
  questions: QuestionRow[];
  decisions: Map<number, CurrentDecision>;
};

/** The run's starter as a core actor. */
export function runActor(run: Pick<Run, 'startedBy' | 'startedByMemberId'>): Actor {
  if (run.startedBy === 'member' && run.startedByMemberId) return member(run.startedByMemberId);
  return run.startedBy === 'hand' ? HAND : BOT;
}

const roundTrigger = (trigger: string): RoundTrigger =>
  ROUND_TRIGGERS.includes(trigger as RoundTrigger) ? (trigger as RoundTrigger) : 'manual';

/** The run as core's round and chain rules see it. */
export function runRecord(run: Run): RunRecord {
  const trigger = roundTrigger(run.trigger);
  return {
    id: String(run.id),
    kind: run.kind,
    status: run.status,
    trigger,
    startedBy: runActor(run),
    sha: run.headSha,
    fixSha: trigger === 'own_fix' ? run.headSha : null,
    level: run.level.number,
  };
}

/** A finding row with its current decision, as core's rules see it. */
export function coreFinding(row: FindingRow, decision: CurrentDecision | undefined): Finding {
  return {
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
    decision: decision?.decision ?? null,
    // Fix checks arrive in S-07.
    resolved: null,
  };
}

function activeRun(run: Run | undefined): ActiveRun | null {
  if (!run) return null;
  const status = run.status === 'queued' ? 'queued' : 'running';
  return {
    kind: run.kind,
    status,
    roundKind: run.kind === 'round' ? ((run.roundNo ?? 1) > 1 ? 'fix_check' : 'full') : null,
    trigger: roundTrigger(run.trigger),
    startedBy: runActor(run),
    roundNumber: run.kind === 'round' ? (run.roundNo ?? 1) : null,
    fixSha: run.trigger === 'own_fix' ? run.headSha : null,
    // Retry from a stage arrives in S-09, the queue's other causes in S-10.
    retryFrom: null,
    queue: status === 'queued' ? { cause: 'slot' } : null,
  };
}

/** The level of a PR's next round: its own level (FR-059), else the repository's default. */
export function prLevel(
  repository: Repository,
  pullRequest: Pick<PullRequest, 'level'>,
): LevelNumber {
  return (
    (pullRequest.level as LevelNumber | null) ?? readRepositoryConfig(repository).value.defaultLevel
  );
}

/**
 * Loads the state input of many PRs in a fixed number of queries. PRs that do not exist are
 * missing from the map.
 */
export async function loadPrStateInputs(
  db: Executor,
  pullRequestIds: readonly number[],
): Promise<Map<number, PrStateLoad>> {
  const ids = [...new Set(pullRequestIds)];
  const loads = new Map<number, PrStateLoad>();
  if (ids.length === 0) return loads;

  const [prRows, runRows, members] = await Promise.all([
    db
      .select({ repository: repositories, pullRequest: pullRequests })
      .from(pullRequests)
      .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
      .where(inArray(pullRequests.id, ids)),
    db
      .select()
      .from(runs)
      .where(and(inArray(runs.pullRequestId, ids), inArray(runs.kind, [...STATE_RUN_KINDS])))
      .orderBy(asc(runs.createdAt), asc(runs.id)),
    db.select().from(teamMembers).where(isNull(teamMembers.removedAt)),
  ]);

  const runsByPr = new Map<number, Run[]>();
  for (const run of runRows) {
    const list = runsByPr.get(run.pullRequestId) ?? [];
    list.push(run);
    runsByPr.set(run.pullRequestId, list);
  }

  // Per PR: rounds oldest first, the latest round, the latest completed round, the active run.
  const perPr = new Map(
    ids.map((id) => {
      const all = runsByPr.get(id) ?? [];
      const rounds = all.filter((run) => run.kind === 'round');
      const completed = rounds.filter((run) => run.status === 'completed');
      return [
        id,
        {
          rounds,
          latestRound: rounds.at(-1),
          reviewed: completed.at(-1),
          active: all.findLast((run) => run.status === 'queued' || run.status === 'running'),
        },
      ] as const;
    }),
  );

  const reviewedIds = [...perPr.values()].flatMap((p) => (p.reviewed ? [p.reviewed.id] : []));
  const failedIds = [...perPr.values()].flatMap((p) =>
    p.latestRound?.status === 'failed' ? [p.latestRound.id] : [],
  );

  const [findingRows, questionRows, failedStages] = await Promise.all([
    reviewedIds.length
      ? db
          .select()
          .from(findings)
          .where(inArray(findings.runId, reviewedIds))
          .orderBy(asc(findings.ordinal))
      : [],
    reviewedIds.length
      ? db
          .select()
          .from(questions)
          .where(inArray(questions.runId, reviewedIds))
          .orderBy(asc(questions.ordinal))
      : [],
    failedIds.length
      ? db
          .select({
            runId: stageExecutions.runId,
            stage: stageExecutions.stage,
            errorCode: stageExecutions.errorCode,
          })
          .from(stageExecutions)
          .where(
            and(inArray(stageExecutions.runId, failedIds), eq(stageExecutions.status, 'failed')),
          )
          .orderBy(desc(stageExecutions.id))
      : [],
  ]);
  const decisions = await currentDecisions(
    db,
    findingRows.map((row) => row.id),
  );

  for (const { repository, pullRequest } of prRows) {
    const p = perPr.get(pullRequest.id)!;
    const reviewed = p.reviewed ?? null;
    const prFindings = reviewed ? findingRows.filter((row) => row.runId === reviewed.id) : [];
    const prQuestions = reviewed ? questionRows.filter((row) => row.runId === reviewed.id) : [];
    const failedStage =
      p.latestRound?.status === 'failed'
        ? failedStages.find((row) => row.runId === p.latestRound!.id)
        : undefined;
    const failedRound: FailedRound | null =
      p.latestRound?.status === 'failed'
        ? {
            // A stage name the worker wrote, for example `review`.
            stage: (failedStage?.stage ?? 'unknown') as StageKey,
            errorCode: failedStage?.errorCode ?? 'unknown',
            roundNumber: p.latestRound.roundNo ?? 1,
            timeoutMinutes: null,
          }
        : null;
    const authorMember =
      members.find((m) => m.githubLogin.toLowerCase() === pullRequest.authorLogin.toLowerCase()) ??
      null;

    const input: PrStateInput = {
      state: pullRequest.state,
      closedBy: null,
      draft: pullRequest.isDraft,
      fork: pullRequest.isFork,
      author: pullRequest.authorLogin,
      level: prLevel(repository, pullRequest),
      headSha: pullRequest.headSha,
      reviewedSha: reviewed?.headSha ?? null,
      commitsSinceReview: reviewed
        ? Math.max(0, pullRequest.commitsCount - reviewed.commitsCountAtStart)
        : 0,
      // Change type arrives in S-04, sensitive files in S-11, patches in S-13.
      changeType: null,
      activeRun: activeRun(p.active),
      failedRound,
      chainRounds: chainState(p.rounds.map(runRecord)).completedRounds,
      findings: prFindings.map((row) => coreFinding(row, decisions.get(row.id))),
      // Answers arrive in S-08, so every question is open.
      questions: prQuestions.map((row) => ({ id: String(row.id), answered: false })),
      sensitive: null,
      patch: null,
      // Opinions arrive in S-08, CI checks and reviews with the merge checklist (S-12).
      reviewers: 0,
      ci: [],
      changesRequestedBy: [],
    };

    loads.set(pullRequest.id, {
      repository,
      pullRequest,
      input,
      authorMember,
      reviewedRound: reviewed,
      findings: prFindings,
      questions: prQuestions,
      decisions: new Map(
        prFindings.flatMap((row) => {
          const decision = decisions.get(row.id);
          return decision ? [[row.id, decision] as const] : [];
        }),
      ),
    });
  }
  return loads;
}

/** The state input of one PR; null when it does not exist. */
export async function loadPrStateInput(
  db: Executor,
  pullRequestId: number,
): Promise<PrStateLoad | null> {
  return (await loadPrStateInputs(db, [pullRequestId])).get(pullRequestId) ?? null;
}

/** How long merged and closed PRs stay on the board. */
export const MERGED_OR_CLOSED_DAYS = 7;

/**
 * The PRs the board shows: every open PR of a connected repository, and those merged or closed in
 * the last 7 days (by GitHub's last update). Most recently opened first.
 */
export async function boardPullRequestIds(db: Executor, now: Date = new Date()): Promise<number[]> {
  const since = new Date(now.getTime() - MERGED_OR_CLOSED_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: pullRequests.id })
    .from(pullRequests)
    .where(
      sql`${pullRequests.state} = 'open' or ${pullRequests.updatedAt} >= ${since.toISOString()}`,
    )
    .orderBy(desc(pullRequests.openedAt), desc(pullRequests.id));
  return rows.map((row) => row.id);
}

/** The newest run of each kind on a PR (P `runs.test.ts` 52). */
export async function latestRunsByKind(
  db: Executor,
  pullRequestId: number,
): Promise<Map<Run['kind'], Run>> {
  const rows = await db
    .select()
    .from(runs)
    .where(eq(runs.pullRequestId, pullRequestId))
    .orderBy(desc(runs.createdAt), desc(runs.id));
  const latest = new Map<Run['kind'], Run>();
  for (const row of rows) if (!latest.has(row.kind)) latest.set(row.kind, row);
  return latest;
}
