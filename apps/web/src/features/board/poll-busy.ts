import type { GitHubPoller } from '@/lib/api-types.ts';

/** How long a poll asked for on the board may take to start and end before its button is on again. */
export const WAIT_MS = 60_000;

/** A Poll now sent at `at`, when the last finished poll was `finishedBefore`. */
export type Asked = { at: number; finishedBefore: string | null };

/**
 * Whether a poll is under way as of `now` (CONNECT): one holds the lease, or the one asked for
 * has not finished yet. A poll held back by GitHub's rate limit never starts, so that wait ends
 * at the backoff, and after `WAIT_MS` in any case. `finishedBefore` compares server times with
 * each other only, never with the browser's clock.
 */
export function pollBusy(poller: GitHubPoller, asked: Asked | null, now: number): boolean {
  if (poller.running) return true;
  if (!asked || poller.backoffUntil !== null || now - asked.at > WAIT_MS) return false;
  return poller.lastFinishedAt === asked.finishedBefore;
}
