// A finished (or open) PR with the history Insights reads (S-19): runs with one stage and one
// session each, findings with verdicts and decisions, PR state rows and head changes. Shared by
// the Insights API tests and the e2e seed.
import { randomUUID } from 'node:crypto';
import {
  freezeLevel,
  laneOf,
  resolveLevel,
  type AgentRole,
  type Decision,
  type LevelNumber,
  type PrState,
  type RunKind,
  type Severity,
  type Verdict,
} from '@pra/core';
import type { Executor } from '../client.ts';
import { recordPrClosed, recordPrReady } from '../queries/metric-logs.ts';
import { upsertPullRequest, type PullRequest } from '../queries/repositories.ts';
import {
  insertAgentSession,
  insertFindings,
  insertRun,
  insertStageExecution,
} from '../queries/runs.ts';
import { headChanges } from '../schema/metrics.ts';
import type { RunInstructionVersion } from '../schema/runs.ts';
import { decisionBatches, findingDecisions } from '../schema/team.ts';
import { prStateChanges } from '../schema/timeline.ts';
import { aPullRequest, seedTeamMember } from './builders.ts';

const MINUTE_MS = 60_000;

export type SeededFinding = {
  severity?: Severity;
  verdict?: Verdict;
  /** The current decision; none when left undecided. */
  decision?: Decision;
};

export type SeededRun = {
  kind?: RunKind;
  levelNumber?: LevelNumber;
  startedAt: Date;
  /** The one stage's duration (default 10). */
  minutes?: number;
  /** The one session's cost, written to the run too (default 0.5). */
  costUsd?: number;
  tokens?: number;
  /** The session's role (default: reviewer, or the implementer and analyst for their kinds). */
  role?: AgentRole;
  instructionVersions?: RunInstructionVersion[];
  findings?: SeededFinding[];
};

export type PrHistorySeed = {
  repositoryId: number;
  number?: number;
  title?: string;
  authorLogin?: string;
  outcome?: 'merged' | 'closed' | 'open';
  readyAt: Date;
  /** When it was merged or closed (default: a day after `readyAt`). */
  finishedAt?: Date;
  headSha?: string;
  runs?: SeededRun[];
  /** PR state rows in order; the lane comes from core `laneOf`. */
  states?: { state: PrState; at: Date; headSha?: string }[];
  headChanges?: {
    afterSha: string;
    at: Date;
    byBot?: boolean;
    isBaseMerge?: boolean;
    pusher?: string;
  }[];
};

const roleOf = (kind: RunKind): AgentRole =>
  kind === 'implementer' ? 'implementer' : kind === 'analyst' ? 'analyst' : 'reviewer';

/** Writes one PR with its history; returns the PR and the run ids in seed order. */
export async function seedPrHistory(
  db: Executor,
  seed: PrHistorySeed,
): Promise<{ pullRequest: PullRequest; runIds: number[] }> {
  const outcome = seed.outcome ?? 'merged';
  const headSha = seed.headSha ?? 'a'.repeat(40);
  const finishedAt = seed.finishedAt ?? new Date(seed.readyAt.getTime() + 24 * 60 * MINUTE_MS);
  const { pullRequest } = await upsertPullRequest(
    db,
    aPullRequest(seed.repositoryId, {
      ...(seed.number !== undefined && { number: seed.number }),
      title: seed.title ?? 'feat: add the thing',
      authorLogin: seed.authorLogin ?? 'octocat',
      headSha,
      state: outcome,
      openedAt: seed.readyAt,
      updatedAt: outcome === 'open' ? seed.readyAt : finishedAt,
    }),
  );
  await recordPrReady(db, pullRequest.id, seed.readyAt);
  if (outcome !== 'open') {
    await recordPrClosed(db, pullRequest.id, {
      at: finishedAt,
      merged: outcome === 'merged' ? { at: finishedAt, sha: 'm'.repeat(40) } : null,
    });
  }

  const runIds: number[] = [];
  const chainId = randomUUID();
  let roundNo = 0;
  let signer: string | undefined;
  for (const spec of seed.runs ?? []) {
    const kind = spec.kind ?? 'round';
    const costUsd = spec.costUsd ?? 0.5;
    const finished = new Date(spec.startedAt.getTime() + (spec.minutes ?? 10) * MINUTE_MS);
    const run = await insertRun(db, {
      pullRequestId: pullRequest.id,
      kind,
      roundNo: kind === 'round' ? ++roundNo : null,
      chainId: kind === 'round' ? chainId : null,
      level: freezeLevel(resolveLevel(spec.levelNumber ?? 1)),
      headSha,
      commitsCountAtStart: 1,
      status: 'completed',
      startedBy: 'bot',
      trigger: 'ready_for_review',
      createdAt: spec.startedAt,
      startedAt: spec.startedAt,
      finishedAt: finished,
      costUsd,
      instructionVersions: spec.instructionVersions ?? [],
    });
    runIds.push(run.id);
    const stage = await insertStageExecution(db, {
      runId: run.id,
      stage: kind === 'implementer' ? 'implement' : 'review',
      attempt: 1,
      status: 'succeeded',
      startedAt: spec.startedAt,
      finishedAt: finished,
    });
    await insertAgentSession(db, {
      stageExecutionId: stage.id,
      role: spec.role ?? roleOf(kind),
      model: 'claude-opus-5-5',
      inputTokens: spec.tokens ?? 1000,
      costUsd,
      costSource: 'reported',
      status: 'completed',
      createdAt: finished,
    });

    const findings = spec.findings ?? [];
    if (findings.length === 0) continue;
    const rows = await insertFindings(
      db,
      findings.map((f, i) => ({
        runId: run.id,
        pullRequestId: pullRequest.id,
        ordinal: i + 1,
        severity: f.severity ?? 'worth_fixing',
        title: `Finding ${i + 1}`,
        file: 'src/index.ts',
        line: 10 + i,
        scenario: 'When the list is empty, the page crashes.',
        suggestion: 'Return early on an empty list.',
        verdict: f.verdict ?? 'unchecked',
        createdAt: finished,
      })),
    );
    for (const [i, finding] of rows.entries()) {
      const decision = findings[i]!.decision;
      if (!decision) continue;
      signer ??= (await seedTeamMember(db)).id;
      const [batch] = await db
        .insert(decisionBatches)
        .values({ pullRequestId: pullRequest.id, decision, signedBy: signer, createdAt: finished })
        .returning({ id: decisionBatches.id });
      await db
        .insert(findingDecisions)
        .values({ findingId: finding.id, batchId: batch!.id, version: finding.version });
    }
  }

  if (seed.states?.length) {
    await db.insert(prStateChanges).values(
      seed.states.map((s) => ({
        pullRequestId: pullRequest.id,
        state: s.state,
        lane: laneOf(s.state),
        reason: { code: 'seeded', params: {} },
        headSha: s.headSha ?? headSha,
        at: s.at,
      })),
    );
  }
  let before = headSha;
  for (const change of seed.headChanges ?? []) {
    await db.insert(headChanges).values({
      pullRequestId: pullRequest.id,
      beforeSha: before,
      afterSha: change.afterSha,
      pusher: change.pusher ?? 'octocat',
      byBot: change.byBot ?? false,
      isBaseMerge: change.isBaseMerge ?? false,
      at: change.at,
    });
    before = change.afterSha;
  }
  return { pullRequest, runIds };
}
