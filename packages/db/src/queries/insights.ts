// Insights (S-19-T3, T4): read-only queries over finished PRs and agent spend. The metrics
// themselves are core rules (`prMetrics`, `pilotMetrics`); these load their inputs.
import type { Decision, LevelNumber, PrHistory, RunKind, Verdict } from '@pra/core';
import { and, asc, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { headChanges } from '../schema/metrics.ts';
import { instructionVersions, pullRequests, repositories } from '../schema/repositories.ts';
import {
  agentSessions,
  findings,
  runs,
  stageExecutions,
  type RunInstructionVersion,
} from '../schema/runs.ts';
import { settingsChanges } from '../schema/settings-changes.ts';
import { prStateChanges } from '../schema/timeline.ts';
import { getAppSettings } from './app-settings.ts';
import { currentDecisions } from './decisions.ts';
import { readRepositoryConfig } from './repositories.ts';

export type InsightsScope = { since: Date; repositoryId?: number | null };

export type FinishedPr = {
  id: number;
  number: number;
  title: string;
  authorLogin: string;
  repositorySlug: string;
  outcome: 'merged' | 'closed';
  /** When it was merged or closed (GitHub's time, else the last snapshot's). */
  finishedAt: Date;
  history: PrHistory;
};

/** When a PR finished: its merge, its close, or (before S-19-T1's logs) its last update. */
const finishedAt = sql<Date>`coalesce(${pullRequests.mergedAt}, ${pullRequests.closedAt}, ${pullRequests.updatedAt})`;

const scopeOf = (scope: InsightsScope): SQL[] => [
  inArray(pullRequests.state, ['merged', 'closed']),
  gte(finishedAt, scope.since),
  ...(scope.repositoryId ? [eq(pullRequests.repositoryId, scope.repositoryId)] : []),
];

/** PRs merged or closed since `since`, newest first, each with its metric history. */
export async function finishedPrHistories(
  db: Executor,
  scope: InsightsScope,
): Promise<FinishedPr[]> {
  const prs = await db
    .select({
      pr: pullRequests,
      repositorySlug: repositories.slug,
      finishedAt: finishedAt.mapWith((value: string | Date) => new Date(value)),
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(and(...scopeOf(scope)))
    .orderBy(sql`${finishedAt} desc`, asc(pullRequests.id));
  if (prs.length === 0) return [];
  const ids = prs.map((row) => row.pr.id);

  const [runRows, stageRows, sessionRows, stateRows, headRows] = await Promise.all([
    db
      .select({ pullRequestId: runs.pullRequestId, kind: runs.kind, status: runs.status })
      .from(runs)
      .where(inArray(runs.pullRequestId, ids))
      .orderBy(asc(runs.id)),
    db
      .select({
        pullRequestId: runs.pullRequestId,
        runKind: runs.kind,
        startedAt: stageExecutions.startedAt,
        finishedAt: stageExecutions.finishedAt,
      })
      .from(stageExecutions)
      .innerJoin(runs, eq(runs.id, stageExecutions.runId))
      .where(inArray(runs.pullRequestId, ids)),
    db
      .select({
        pullRequestId: runs.pullRequestId,
        runKind: runs.kind,
        costUsd: agentSessions.costUsd,
        tokens: sql<number>`${agentSessions.inputTokens} + ${agentSessions.outputTokens}`.mapWith(
          Number,
        ),
      })
      .from(agentSessions)
      .innerJoin(stageExecutions, eq(stageExecutions.id, agentSessions.stageExecutionId))
      .innerJoin(runs, eq(runs.id, stageExecutions.runId))
      .where(inArray(runs.pullRequestId, ids)),
    db
      .select()
      .from(prStateChanges)
      .where(inArray(prStateChanges.pullRequestId, ids))
      .orderBy(asc(prStateChanges.at), asc(prStateChanges.id)),
    db
      .select()
      .from(headChanges)
      .where(inArray(headChanges.pullRequestId, ids))
      .orderBy(asc(headChanges.at), asc(headChanges.id)),
  ]);

  const byPr = <T extends { pullRequestId: number }>(rows: T[]) => {
    const map = new Map<number, T[]>();
    for (const row of rows)
      map.set(row.pullRequestId, [...(map.get(row.pullRequestId) ?? []), row]);
    return (id: number) => map.get(id) ?? [];
  };
  const runsOf = byPr(runRows);
  const stagesOf = byPr(stageRows);
  const sessionsOf = byPr(sessionRows);
  const statesOf = byPr(stateRows);
  const headsOf = byPr(headRows);

  return prs.map(({ pr, repositorySlug, finishedAt: finished }) => {
    const outcome = pr.state === 'merged' ? 'merged' : 'closed';
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      authorLogin: pr.authorLogin,
      repositorySlug,
      outcome,
      finishedAt: finished,
      history: {
        outcome,
        readyAt: pr.readyAt,
        mergedAt: outcome === 'merged' ? (pr.mergedAt ?? finished) : null,
        mergedHeadSha: outcome === 'merged' ? pr.headSha : null,
        runs: runsOf(pr.id),
        stages: stagesOf(pr.id),
        sessions: sessionsOf(pr.id),
        stateChanges: statesOf(pr.id),
        headChanges: headsOf(pr.id),
      },
    };
  });
}

export type SpendRow = {
  day: string;
  repositorySlug: string;
  role: string;
  runKind: string;
  /** The run's review level number. */
  level: number;
  costUsd: number;
};

/** Agent spend since `since`, summed per UTC day, repository, role, run kind and level. */
export function spendRows(db: Executor, scope: InsightsScope): Promise<SpendRow[]> {
  const day = sql<string>`to_char(${agentSessions.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`;
  const level = sql<number>`(${runs.level} ->> 'number')::int`;
  return db
    .select({
      day,
      repositorySlug: repositories.slug,
      role: agentSessions.role,
      runKind: runs.kind,
      level: level.mapWith(Number),
      costUsd: sql<number>`coalesce(sum(${agentSessions.costUsd}), 0)`.mapWith(Number),
    })
    .from(agentSessions)
    .innerJoin(stageExecutions, eq(stageExecutions.id, agentSessions.stageExecutionId))
    .innerJoin(runs, eq(runs.id, stageExecutions.runId))
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      and(
        gte(agentSessions.createdAt, scope.since),
        ...(scope.repositoryId ? [eq(pullRequests.repositoryId, scope.repositoryId)] : []),
      ),
    )
    .groupBy(day, repositories.slug, agentSessions.role, runs.kind, level)
    .orderBy(day);
}

/** The mean cost of rounds that completed since `since`; null when none did. */
export async function averageRoundCost(db: Executor, scope: InsightsScope): Promise<number | null> {
  const [row] = await db
    .select({ average: sql<string | null>`avg(${runs.costUsd})` })
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .where(
      and(
        eq(runs.kind, 'round'),
        eq(runs.status, 'completed'),
        gte(runs.finishedAt, scope.since),
        ...(scope.repositoryId ? [eq(pullRequests.repositoryId, scope.repositoryId)] : []),
      ),
    );
  return row?.average == null ? null : Number(row.average);
}

export type QualityRun = {
  id: number;
  repositoryId: number;
  kind: RunKind;
  level: LevelNumber;
  /** The run's frozen level ran Verify. */
  verifyRan: boolean;
  costUsd: number;
  instructionVersions: RunInstructionVersion[];
};
export type QualityFinding = { runId: number; verdict: Verdict; decision: Decision | null };

/**
 * Rounds and implementer runs created since `since` (every one when null), with their findings
 * and each finding's current decision. Trials and the analyst are not PR work.
 */
export async function qualityInputs(
  db: Executor,
  scope: { since: Date | null; repositoryId?: number | null },
): Promise<{ runs: QualityRun[]; findings: QualityFinding[] }> {
  const runRows = await db
    .select({
      id: runs.id,
      repositoryId: pullRequests.repositoryId,
      kind: runs.kind,
      level: sql<number>`(${runs.level} ->> 'number')::int`.mapWith(Number),
      verifyRan: sql<boolean>`coalesce((${runs.level} -> 'stages' ->> 'verify')::boolean, false)`,
      costUsd: runs.costUsd,
      instructionVersions: runs.instructionVersions,
    })
    .from(runs)
    .innerJoin(pullRequests, eq(pullRequests.id, runs.pullRequestId))
    .where(
      and(
        inArray(runs.kind, ['round', 'implementer']),
        ...(scope.since ? [gte(runs.createdAt, scope.since)] : []),
        ...(scope.repositoryId ? [eq(pullRequests.repositoryId, scope.repositoryId)] : []),
      ),
    )
    .orderBy(asc(runs.id));
  if (runRows.length === 0) return { runs: [], findings: [] };
  const findingRows = await db
    .select({ id: findings.id, runId: findings.runId, verdict: findings.verdict })
    .from(findings)
    .where(
      inArray(
        findings.runId,
        runRows.map((run) => run.id),
      ),
    );
  const decisions = await currentDecisions(
    db,
    findingRows.map((row) => row.id),
  );
  return {
    runs: runRows.map((run) => ({ ...run, level: run.level as LevelNumber })),
    findings: findingRows.map((row) => ({
      runId: row.runId,
      verdict: row.verdict,
      decision: decisions.get(row.id)?.decision ?? null,
    })),
  };
}

export type InstructionVersionLabel = {
  id: number;
  scope: 'global' | 'repository';
  fileKey: string;
  version: number;
  status: string;
  repositorySlug: string | null;
};

/** The instruction versions with these ids, for labels. */
export function instructionVersionLabels(
  db: Executor,
  ids: readonly number[],
): Promise<InstructionVersionLabel[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: instructionVersions.id,
      scope: instructionVersions.scope,
      fileKey: instructionVersions.fileKey,
      version: instructionVersions.version,
      status: instructionVersions.status,
      repositorySlug: repositories.slug,
    })
    .from(instructionVersions)
    .leftJoin(repositories, eq(repositories.id, instructionVersions.repositoryId))
    .where(inArray(instructionVersions.id, [...ids]));
}

export type RepositoryLevel = {
  id: number;
  slug: string;
  level: LevelNumber;
  /** When the current default level was set: its last change in the settings log, else when the
   * repository was connected. */
  since: Date;
};

/** Every repository (or one) with its current default level and since when it holds. */
export async function repositoryLevels(
  db: Executor,
  repositoryId?: number | null,
): Promise<RepositoryLevel[]> {
  // The outer row is named in full: inside the subquery a bare "id" would be settings_changes.id.
  const levelChanged = sql<Date | null>`(
    select max(${settingsChanges.at}) from ${settingsChanges}
    where ${settingsChanges.area} = 'repositories'
      and ${settingsChanges.entity} = "repositories"."id"::text
      and (${settingsChanges.before} is null
        or ${settingsChanges.before} ->> 'defaultLevel'
          is distinct from ${settingsChanges.after} ->> 'defaultLevel'))`;
  const rows = await db
    .select({
      repository: repositories,
      levelChanged: levelChanged.mapWith((value: string | Date | null) =>
        value === null ? null : new Date(value),
      ),
    })
    .from(repositories)
    .where(repositoryId ? eq(repositories.id, repositoryId) : undefined)
    .orderBy(asc(repositories.slug));
  const globalLevel = (await getAppSettings(db)).value.defaultLevel;
  return rows.map(({ repository, levelChanged: changed }) => ({
    id: repository.id,
    slug: repository.slug,
    level: readRepositoryConfig(repository).value.defaultLevel ?? globalLevel,
    since: changed ?? repository.createdAt,
  }));
}
