// Builds core's `PrStateInput` from the database, for the board and the PR page. Reads only.
import {
  chainState,
  member,
  queueCauseOf,
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
import { roundChains } from '../schema/chains.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { findings, questions, runs, stageExecutions } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';
import { currentDecisions, type CurrentDecision } from './decisions.ts';
import { newestFixChecks, type FixCheck } from './fix-checks.ts';
import { sensitiveFilesOf, sensitiveState, type SensitiveFile } from './sensitive-files.ts';
import { runWaitsOf, type RunWait } from './status.ts';
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
  /** The latest completed round: its head is the reviewed SHA; null before one completed. */
  reviewedRound: Run | null;
  /**
   * The completed full review (round 1 of its chain) the findings and questions come from; fix
   * checks only add Resolved / Not resolved to them.
   */
  findingsRound: Run | null;
  /** The PR's sensitive files with their pattern and status, in path order. */
  sensitiveFiles: SensitiveFile[];
  findings: FindingRow[];
  questions: QuestionRow[];
  decisions: Map<number, CurrentDecision>;
  /** The newest fix status of each finding that has one. */
  fixChecks: Map<number, FixCheck>;
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
export function coreFinding(
  row: FindingRow,
  decision: CurrentDecision | undefined,
  fixCheck?: Pick<FixCheck, 'resolved'>,
): Finding {
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
    resolved: fixCheck?.resolved ?? null,
  };
}

/** `wait`: why the run waits (S-10); a started run that waits before a session reads as queued. */
function activeRun(run: Run | undefined, wait?: RunWait): ActiveRun | null {
  if (!run) return null;
  const status = run.status === 'queued' || wait?.reason ? 'queued' : 'running';
  return {
    kind: run.kind,
    status,
    roundKind: run.kind === 'round' ? ((run.roundNo ?? 1) > 1 ? 'fix_check' : 'full') : null,
    trigger: roundTrigger(run.trigger),
    startedBy: runActor(run),
    roundNumber: run.kind === 'round' ? (run.roundNo ?? 1) : null,
    fixSha: run.trigger === 'own_fix' ? run.headSha : null,
    // Retry from a stage arrives in S-09.
    retryFrom: null,
    queue: status === 'queued' ? queueCauseOf(wait?.reason) : null,
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
 * Commits on the head since the reviewed round: measured with GitHub's compare when the head moved
 * (`runs.commits_since`), else the difference of commit counts. The fix PR Review Agent pushed and
 * did not check (the chain used its rounds) is not "new commits": FR-017 is about people's pushes.
 */
function commitsSinceReview(
  pullRequest: PullRequest,
  reviewed: Run | null,
  chain: typeof roundChains.$inferSelect | null,
): number {
  if (!reviewed) return 0;
  if (chain?.expectedHeadSha && chain.expectedHeadSha === pullRequest.headSha) return 0;
  return commitsSinceRun(pullRequest, reviewed);
}

/** The head is the chain's expected fix and no round reviewed it (the start takes the head). */
function ownFixUnchecked(
  pullRequest: PullRequest,
  reviewed: Run | null,
  chain: typeof roundChains.$inferSelect | null,
): boolean {
  return (
    !!chain?.expectedHeadSha &&
    chain.expectedHeadSha === pullRequest.headSha &&
    reviewed?.headSha !== pullRequest.headSha
  );
}

/**
 * Commits on the PR's head since a round's head (FR-045 "N commits behind"): 0 on the same head,
 * else GitHub's compare when it was measured against this head, else the commit-count difference.
 * A head other than the round's is never 0: a force push (same count) or a reset (compare ahead 0)
 * is code nobody reviewed, so it must not read as Ready to merge.
 */
export function commitsSinceRun(
  pullRequest: Pick<PullRequest, 'headSha' | 'commitsCount'>,
  run: Pick<Run, 'headSha' | 'commitsSince' | 'commitsSinceHead' | 'commitsCountAtStart'>,
): number {
  if (run.headSha === pullRequest.headSha) return 0;
  const since =
    run.commitsSince !== null && run.commitsSinceHead === pullRequest.headSha
      ? run.commitsSince
      : pullRequest.commitsCount - run.commitsCountAtStart;
  return Math.max(1, since);
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
          findingsRound: completed.findLast((run) => (run.roundNo ?? 1) === 1),
          active: all.findLast((run) => run.status === 'queued' || run.status === 'running'),
        },
      ] as const;
    }),
  );

  const reviewedIds = [...perPr.values()].flatMap((p) =>
    p.findingsRound ? [p.findingsRound.id] : [],
  );
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
  const [decisions, fixChecks, sensitiveByPr] = await Promise.all([
    currentDecisions(
      db,
      findingRows.map((row) => row.id),
    ),
    newestFixChecks(
      db,
      findingRows.map((row) => row.id),
    ),
    sensitiveFilesOf(
      db,
      prRows.map((row) => row.pullRequest.id),
    ),
  ]);
  const chainIds = [...perPr.values()].flatMap((p) =>
    p.latestRound?.chainId ? [p.latestRound.chainId] : [],
  );
  const waits = await runWaitsOf(
    db,
    [...perPr.values()].flatMap((p) => (p.active ? [p.active.id] : [])),
  );
  const chainById = new Map(
    (chainIds.length
      ? await db.select().from(roundChains).where(inArray(roundChains.id, chainIds))
      : []
    ).map((chain) => [chain.id, chain] as const),
  );

  for (const { repository, pullRequest } of prRows) {
    const p = perPr.get(pullRequest.id)!;
    const reviewed = p.reviewed ?? null;
    const findingsRound = p.findingsRound ?? null;
    const prFindings = findingsRound
      ? findingRows.filter((row) => row.runId === findingsRound.id)
      : [];
    const prQuestions = findingsRound
      ? questionRows.filter((row) => row.runId === findingsRound.id)
      : [];
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
      commitsSinceReview: commitsSinceReview(
        pullRequest,
        reviewed,
        chainById.get(p.latestRound?.chainId ?? '') ?? null,
      ),
      // Change type arrives in S-04, patches in S-13.
      changeType: null,
      activeRun: activeRun(p.active, p.active && waits.get(p.active.id)),
      failedRound,
      chainRounds: chainState(p.rounds.map(runRecord)).completedRounds,
      ownFixUnchecked: ownFixUnchecked(
        pullRequest,
        reviewed,
        chainById.get(p.latestRound?.chainId ?? '') ?? null,
      ),
      findings: prFindings.map((row) =>
        coreFinding(row, decisions.get(row.id), fixChecks.get(row.id)),
      ),
      // Answers arrive in S-08, so every question is open.
      questions: prQuestions.map((row) => ({ id: String(row.id), answered: false })),
      sensitive: sensitiveState(sensitiveByPr.get(pullRequest.id) ?? []),
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
      findingsRound,
      sensitiveFiles: sensitiveByPr.get(pullRequest.id) ?? [],
      findings: prFindings,
      questions: prQuestions,
      decisions: new Map(
        prFindings.flatMap((row) => {
          const decision = decisions.get(row.id);
          return decision ? [[row.id, decision] as const] : [];
        }),
      ),
      fixChecks: new Map(
        prFindings.flatMap((row) => {
          const check = fixChecks.get(row.id);
          return check ? [[row.id, check] as const] : [];
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
