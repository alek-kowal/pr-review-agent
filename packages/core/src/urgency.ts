// S-17-T2: how urgent an Action needed card is (FR-008).
import { ACTION_NEEDED_ORDER, type PrState } from './pr-state.ts';

/**
 * The urgency rank of a PR state in the Action needed lane, 0 first: failed, questions, findings
 * to decide, sensitive files, patch ready, waiting for the fix, new commits, automatic rounds
 * used. A state outside that list ranks after all of them.
 */
export function actionNeededRank(state: PrState): number {
  const i = ACTION_NEEDED_ORDER.indexOf(state);
  return i < 0 ? ACTION_NEEDED_ORDER.length : i;
}

/** What the urgency sort reads from a card: its state and when the PR was opened. */
export type UrgencyItem = { state: PrState; openedAt: string | Date };

/**
 * Sorts Action needed by urgency rank, then by age: the PR waiting longest (opened first) comes
 * first among equal ranks.
 */
export function byUrgency(a: UrgencyItem, b: UrgencyItem): number {
  return (
    actionNeededRank(a.state) - actionNeededRank(b.state) ||
    new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
  );
}
