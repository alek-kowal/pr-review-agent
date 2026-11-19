// Creates a queued round and queues its first stage. Round 1 from a webhook comes through here;
// P-11 builds `createRun` under it for manual starts and chains.
import {
  freezeLevel,
  planRun,
  resolveLevel,
  type Actor,
  type LevelNumber,
  type RoundTrigger,
} from '@pra/core';
import { insertRun, isUniqueViolation, type PullRequest, type Run } from '@pra/db';
import { randomUUID } from 'node:crypto';
import type { WorkerDeps } from '../deps.ts';
import { sendStageJob } from './jobs.ts';

export type StartRoundInput = {
  pullRequest: PullRequest;
  level: LevelNumber;
  trigger: RoundTrigger;
  startedBy: Actor;
  roundNumber: number;
  /** The chain this round continues; a new chain when omitted. */
  chainId?: string;
};

export type StartRoundResult =
  { started: true; run: Run; firstStage: string } | { started: false; reason: 'run_active' };

export async function startRound(
  deps: Pick<WorkerDeps, 'db' | 'queue' | 'logger'>,
  input: StartRoundInput,
): Promise<StartRoundResult> {
  const { pullRequest, startedBy, roundNumber } = input;
  // App-level level overrides arrive with P-23; until then the built-in level applies.
  const level = freezeLevel(resolveLevel(input.level));
  const plan = planRun({
    kind: 'round',
    level: input.level,
    roundKind: roundNumber > 1 ? 'fix_check' : 'full',
    roundNumber,
  });

  let run: Run;
  try {
    run = await insertRun(deps.db, {
      pullRequestId: pullRequest.id,
      kind: 'round',
      roundNo: roundNumber,
      chainId: input.chainId ?? randomUUID(),
      level,
      headSha: pullRequest.headSha,
      commitsCountAtStart: pullRequest.commitsCount,
      status: 'queued',
      startedBy: startedBy.kind,
      startedByMemberId: startedBy.kind === 'member' ? startedBy.memberId : null,
      trigger: input.trigger,
    });
  } catch (error) {
    // Another event started a round for this PR first.
    if (isUniqueViolation(error, 'runs_one_active_per_pr')) {
      return { started: false, reason: 'run_active' };
    }
    throw error;
  }

  // A round always has Review on; the job for the first planned stage starts the run either way.
  const firstStage = (plan.stages.find((s) => s.status === 'pending') ?? plan.stages[0]!).key;
  await sendStageJob(deps.queue, run.id, firstStage);
  deps.logger.info(
    { runId: run.id, pullRequestId: pullRequest.id, round: roundNumber, stage: firstStage },
    'round queued',
  );
  return { started: true, run, firstStage };
}
