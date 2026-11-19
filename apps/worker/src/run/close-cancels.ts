// S-09-T5: a closed PR (merged or not) cancels its active or queued run as PR Review Agent, with
// the timeline entry "Run cancelled: PR closed" and no GitHub comment (FR-023).
import { BOT } from '@pra/core';
import { activeBlockingRun, requestRunCancel } from '@pra/db';
import type { PrEventHook } from '../github-events/pr-hooks.ts';
import { finishCancel } from './cancel.ts';

export const cancelOnClosed: PrEventHook = async ({ deps, pullRequest }) => {
  const run = await activeBlockingRun(deps.db, pullRequest.id);
  if (!run) return;
  const request = await requestRunCancel(deps.db, run.id, { actor: BOT, reason: 'pr_closed' });
  if (!request.requested) return;
  deps.logger.info({ runId: run.id, pullRequestId: pullRequest.id }, 'PR closed: run cancelled');
  // Finished here, not only by the listener: a stage of this process is aborted at once.
  await finishCancel(deps, run.id);
};
