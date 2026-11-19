import type { NextStep, Reason } from '@pra/core';
import type { PrStateLoad } from '@pra/db';

/** What a card badge reads: the PR's loaded state and its Next step. */
export interface CardBadgeContext {
  load: PrStateLoad;
  nextStep: NextStep;
}

/** One small badge on a board card, as a reason code; null when the card shows none. */
export type CardBadge = (context: CardBadgeContext) => Reason | null;

/**
 * Board card badges, in display order (extension point from P-08). A package that adds a badge
 * adds a function here and copy for its code in the web's `copy.board.badges`.
 */
export const CARD_BADGES: readonly CardBadge[] = [];

export const cardBadges = (context: CardBadgeContext): Reason[] =>
  CARD_BADGES.map((badge) => badge(context)).filter((badge): badge is Reason => badge !== null);
