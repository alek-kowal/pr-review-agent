// S-07-T1: one way to create runs. `createRun` inserts a queued run and queues its first stage;
// `startRound` decides the chain and round number for the ready webhook, a manual start and a fix
// push, then calls `createRun`. P-17 (trials), P-18 (implementer) and P-21 (analyst) call
// `createRun` directly. Start gates run when the first stage job starts (worker, P-05).
import {
  chainState,
  freezeLevel,
  nextAutomaticRound,
  planRun,
  reason,
  resolveLevel,
  resolveRunModels,
  type Actor,
  type LevelNumber,
  type Reason,
  type RoundTrigger,
  type RunKind,
  type RunState,
} from '@pra/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { Db, Executor } from '../client.ts';
import { JOBS, sendJob, type Queue } from '../queue.ts';
import { roundChains } from '../schema/chains.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { runs } from '../schema/runs.ts';
import { getAppSettings } from './app-settings.ts';
import { getLevelOverrides, getRoleModels } from './level-settings.ts';
import { prLevel, runRecord } from './pr-state.ts';
import type { PullRequest } from './repositories.ts';
import { activeBlockingRun } from './run-engine.ts';
import { insertRun, isUniqueViolation, type Run } from './runs.ts';

export type RoundChain = typeof roundChains.$inferSelect;

type Logger = { info: (data: Record<string, unknown>, message: string) => void };

export type RunStartDeps = { db: Db; queue: Queue; logger?: Logger };

/** A stage job expires after the run's stage timeout plus this margin (the backstop, S-09-T6). */
const STAGE_JOB_EXPIRY_MARGIN_SECONDS = 10 * 60;

/** Seconds a stage job of this run may stay active before pg-boss expires it. */
export const stageJobExpirySeconds = (run: Pick<Run, 'level'>): number =>
  run.level.settings.stageTimeoutMinutes * 60 + STAGE_JOB_EXPIRY_MARGIN_SECONDS;

/**
 * Queues one stage of one run. The `run.stage` queue is `exclusive` on the key, so a second send
 * while the first job is queued or active is dropped. Pass the run to expire the job at its stage
 * timeout (the queue default is the longest timeout allowed).
 */
export function sendStageJob(
  queue: Queue,
  runId: number,
  stage: string,
  run?: Pick<Run, 'level'>,
): Promise<string | null> {
  return sendJob(
    queue,
    JOBS.runStage,
    { runId, stage },
    {
      singletonKey: `${runId}:${stage}`,
      ...(run ? { expireInSeconds: stageJobExpirySeconds(run) } : {}),
    },
  );
}

export type CreateRunInput = {
  pullRequest: PullRequest;
  kind: RunKind;
  level: LevelNumber;
  /** Core `planRun` for the run; its first pending stage is queued. */
  plan: RunState;
  /** Why the run starts, a reason code (`ready_for_review`, `manual`, `own_fix`, ...). */
  trigger: string;
  startedBy: Actor;
  roundNo?: number | null;
  chainId?: string | null;
  /** Runs in the transaction that inserts the run, before it (for example a new chain row). */
  beforeInsert?: (tx: Executor) => Promise<void>;
  /** Runs in the transaction that inserts the run (for example to record what started it). */
  inTransaction?: (tx: Executor, run: Run) => Promise<void>;
};

export type CreateRunResult =
  { created: true; run: Run; firstStage: string } | { created: false; reason: 'run_active' };

/** Inserts the run as queued and sends its first stage job; `run_active` when the PR is held. */
export async function createRun(
  deps: RunStartDeps,
  input: CreateRunInput,
): Promise<CreateRunResult> {
  const { pullRequest, startedBy } = input;
  let run: Run;
  try {
    run = await deps.db.transaction(async (tx) => {
      await input.beforeInsert?.(tx);
      // S-21-T2: the level with its settings and every role's model, frozen for the run.
      const [overrides, roleModels] = await Promise.all([getLevelOverrides(tx), getRoleModels(tx)]);
      const level = resolveLevel(input.level, overrides.value);
      const inserted = await insertRun(tx, {
        pullRequestId: pullRequest.id,
        kind: input.kind,
        roundNo: input.roundNo ?? null,
        chainId: input.chainId ?? null,
        level: freezeLevel(level),
        models: resolveRunModels(level, roleModels),
        headSha: pullRequest.headSha,
        commitsCountAtStart: pullRequest.commitsCount,
        status: 'queued',
        startedBy: startedBy.kind,
        startedByMemberId: startedBy.kind === 'member' ? startedBy.memberId : null,
        trigger: input.trigger,
      });
      await input.inTransaction?.(tx, inserted);
      return inserted;
    });
  } catch (error) {
    // Another start for this PR won.
    if (isUniqueViolation(error, 'runs_one_active_per_pr')) {
      return { created: false, reason: 'run_active' };
    }
    throw error;
  }
  const firstStage = (
    input.plan.stages.find((s) => s.status === 'pending') ?? input.plan.stages[0]!
  ).key;
  await sendStageJob(deps.queue, run.id, firstStage, run);
  deps.logger?.info(
    { runId: run.id, pullRequestId: pullRequest.id, kind: run.kind, stage: firstStage },
    'run queued',
  );
  return { created: true, run, firstStage };
}

export type StartRoundInput = {
  pullRequestId: number;
  /** `ready_for_review` and `manual` begin a new chain; `own_fix` continues the latest one. */
  trigger: RoundTrigger;
  startedBy: Actor;
  /** The level picked for a manual start; otherwise the PR's level (or the chain's for a fix). */
  level?: LevelNumber;
  inTransaction?: (tx: Executor, run: Run) => Promise<void>;
};

export type StartRoundResult =
  | { started: true; run: Run; firstStage: string; roundNumber: number }
  | { started: false; reason: Reason };

/** Thrown inside the run's transaction when another start already took the chain's expected head. */
class ExpectedHeadTaken extends Error {}

/** The PR's rounds, oldest first. */
export async function roundsOf(db: Executor, pullRequestId: number): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.pullRequestId, pullRequestId), eq(runs.kind, 'round')))
    .orderBy(asc(runs.createdAt), asc(runs.id));
}

export async function getRoundChain(db: Executor, chainId: string): Promise<RoundChain | null> {
  const [row] = await db.select().from(roundChains).where(eq(roundChains.id, chainId));
  return row ?? null;
}

/** The PR's latest chain (the chain of its latest round); null before its first round. */
export async function latestChainOf(
  db: Executor,
  pullRequestId: number,
): Promise<RoundChain | null> {
  const [latest] = await db
    .select({ chainId: runs.chainId })
    .from(runs)
    .where(and(eq(runs.pullRequestId, pullRequestId), eq(runs.kind, 'round')))
    .orderBy(desc(runs.createdAt), desc(runs.id))
    .limit(1);
  return latest?.chainId ? getRoundChain(db, latest.chainId) : null;
}

/**
 * The commit PR Review Agent pushed as a fix: the next round starts only on that head. S-14's push
 * records it through the worker's `expectOwnFix`, which also covers a webhook handled before it.
 */
export async function setChainExpectedHead(
  db: Executor,
  chainId: string,
  sha: string | null,
): Promise<void> {
  await db.update(roundChains).set({ expectedHeadSha: sha }).where(eq(roundChains.id, chainId));
}

/**
 * Starts a round. A ready event or a manual start opens a new chain at round 1; an own fix starts
 * round `completed + 1` of the latest chain when core `nextAutomaticRound` allows it.
 */
export async function startRound(
  deps: RunStartDeps,
  input: StartRoundInput,
): Promise<StartRoundResult> {
  const [row] = await deps.db
    .select({ repository: repositories, pullRequest: pullRequests })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(eq(pullRequests.id, input.pullRequestId));
  if (!row)
    return {
      started: false,
      reason: reason('pr_not_found', { pullRequestId: input.pullRequestId }),
    };
  const { repository, pullRequest } = row;
  if (pullRequest.state !== 'open') return { started: false, reason: reason('pr_closed') };

  let roundNumber = 1;
  let chainId: string;
  let level =
    input.level ??
    prLevel(repository, pullRequest, (await getAppSettings(deps.db)).value.defaultLevel);
  let newChain = true;
  if (input.trigger === 'own_fix') {
    const rounds = await roundsOf(deps.db, pullRequest.id);
    const chain = await latestChainOf(deps.db, pullRequest.id);
    const decision = nextAutomaticRound(
      { state: pullRequest.state, headSha: pullRequest.headSha, level },
      chainState(rounds.map(runRecord)),
      chain?.expectedHeadSha ?? null,
    );
    if (!decision.start || !chain) {
      return {
        started: false,
        reason: decision.start
          ? reason('head_not_own_fix', { headSha: pullRequest.headSha, fixSha: null })
          : decision.reason,
      };
    }
    roundNumber = decision.roundNumber;
    chainId = chain.id;
    newChain = false;
    // A chain keeps the level its first round froze.
    const first = rounds.find((run) => run.chainId === chain.id);
    if (first) level = first.level.number;
  } else {
    chainId = randomUUID();
  }

  let result: CreateRunResult;
  try {
    result = await createRun(deps, {
      pullRequest,
      kind: 'round',
      level,
      plan: planRun({
        kind: 'round',
        level,
        roundKind: roundNumber > 1 ? 'fix_check' : 'full',
        roundNumber,
      }),
      trigger: input.trigger,
      startedBy: input.startedBy,
      roundNo: roundNumber,
      chainId,
      beforeInsert: async (tx) => {
        if (newChain) {
          await tx.insert(roundChains).values({ id: chainId, pullRequestId: pullRequest.id });
          return;
        }
        // The fix is being checked: a retried event or a later push on it starts nothing. Taking
        // the expected head is atomic, so two starts on one fix push make one round.
        const [taken] = await tx
          .update(roundChains)
          .set({ expectedHeadSha: null })
          .where(
            and(eq(roundChains.id, chainId), eq(roundChains.expectedHeadSha, pullRequest.headSha)),
          )
          .returning({ id: roundChains.id });
        if (!taken) throw new ExpectedHeadTaken();
      },
      inTransaction: input.inTransaction,
    });
  } catch (error) {
    if (!(error instanceof ExpectedHeadTaken)) throw error;
    return {
      started: false,
      reason: reason('head_not_own_fix', { headSha: pullRequest.headSha, fixSha: null }),
    };
  }
  if (!result.created) {
    const active = await activeBlockingRun(deps.db, pullRequest.id);
    return {
      started: false,
      reason: reason('run_active', {
        kind: active?.kind ?? 'round',
        status: active?.status === 'running' ? 'running' : 'queued',
      }),
    };
  }
  return { started: true, run: result.run, firstStage: result.firstStage, roundNumber };
}

/** Sets the level of a PR's next rounds (FR-059); a running run keeps its frozen level. */
export async function setPullRequestLevel(
  db: Executor,
  pullRequestId: number,
  level: LevelNumber | null,
): Promise<void> {
  await db.update(pullRequests).set({ level }).where(eq(pullRequests.id, pullRequestId));
}
