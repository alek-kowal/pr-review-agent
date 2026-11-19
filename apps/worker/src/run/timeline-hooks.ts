// S-03-T5: the worker's timeline writers. PR event hooks log what GitHub reported; run hooks log
// how runs ended. Each entry has a source key, so a retried event or hook writes nothing twice;
// each writer then logs the PR's state when it changed.
import { BOT, HAND, type Actor } from '@pra/core';
import {
  getGithubEvent,
  recordStateChange,
  recordTimelineEntry,
  runActor,
  stageExecutionsOfRun,
  type Executor,
  type Run,
  type Transactor,
} from '@pra/db';
import type { PrEventContext, PrEventHook, PrEventKind } from '../github-events/pr-hooks.ts';
import type { RunHook } from './hooks.ts';

/** GitHub tells us what happened, not who did it in the app: `hand`, via GitHub. */
const GITHUB: Actor = HAND;

const PR_EVENT_ENTRY: Record<PrEventKind, string> = {
  ready: 'pr_ready',
  headChanged: 'pr_pushed',
  closed: 'pr_closed',
  merged: 'pr_merged',
};

function prEventEntry(kind: PrEventKind): PrEventHook {
  return async ({ deps, pullRequest, previous, snapshot, action, eventId }: PrEventContext) => {
    // A merge from the app already wrote "merged" with its signer (S-12).
    if (kind === 'merged' && previous?.state === 'merged') return;
    const event = await getGithubEvent(deps.db, eventId);
    const at = event?.receivedAt ?? new Date();
    await recordTimelineEntry(deps.db, {
      pullRequestId: pullRequest.id,
      actor: GITHUB,
      kind: PR_EVENT_ENTRY[kind],
      params: {
        via: 'github',
        action,
        ...(kind === 'headChanged'
          ? { headSha: snapshot.headSha, previousSha: previous?.headSha ?? null }
          : {}),
      },
      at,
      sourceKey: `github_event:${eventId}:${kind}`,
    });
    await recordStateChange(deps.db, pullRequest.id, { code: PR_EVENT_ENTRY[kind] }, { at });
  };
}

export const timelineOnReady = prEventEntry('ready');
export const timelineOnHeadChanged = prEventEntry('headChanged');
export const timelineOnClosed = prEventEntry('closed');
export const timelineOnMerged = prEventEntry('merged');

const runParams = (run: Run) => ({ runKind: run.kind, roundNumber: run.roundNo });

/** In the run's start transaction: "Round 1 of 3 started" by whoever started it. */
export async function recordRunStarted(
  tx: Executor & Transactor,
  run: Run,
  at: Date,
): Promise<void> {
  await recordTimelineEntry(tx, {
    pullRequestId: run.pullRequestId,
    actor: runActor(run),
    kind: 'run_started',
    params: { ...runParams(run), trigger: run.trigger },
    runId: run.id,
    at,
    sourceKey: `run:${run.id}:started`,
  });
  await recordStateChange(tx, run.pullRequestId, { code: 'run_started' }, { at });
}

function runEnded(kind: 'run_finished' | 'run_failed' | 'run_cancelled'): RunHook {
  return async ({ deps, run }) => {
    // A trial leaves the PR untouched; its cost is reported with the trial (S-22-T6).
    if (run.kind === 'trial') return;
    const at = run.finishedAt ?? new Date();
    let failure = {};
    if (kind === 'run_failed') {
      const failed = (await stageExecutionsOfRun(deps.db, run.id))
        .filter((execution) => execution.status === 'failed')
        .at(-1);
      failure = { stage: failed?.stage ?? null, errorCode: failed?.errorCode ?? null };
    }
    await recordTimelineEntry(deps.db, {
      pullRequestId: run.pullRequestId,
      actor: BOT,
      kind,
      params: { ...runParams(run), ...failure },
      runId: run.id,
      costUsd: run.costUsd,
      at,
      sourceKey: `run:${run.id}:ended`,
    });
    await recordStateChange(deps.db, run.pullRequestId, { code: kind }, { at });
  };
}

export const timelineOnRunCompleted = runEnded('run_finished');
export const timelineOnRunFailed = runEnded('run_failed');
export const timelineOnRunCancelled = runEnded('run_cancelled');
