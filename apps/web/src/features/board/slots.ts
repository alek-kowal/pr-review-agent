import type { ComponentType } from 'react';
import { CardAlertBell } from '@/features/alerts/BoardAlerts.tsx';
import type { BoardCard } from '@/lib/api-types.ts';

export type CardBadgeSlotProps = { card: BoardCard };

/**
 * Board card badge slots (extension point from P-08): small items at the end of a card's second
 * line, in order. The api's `CARD_BADGES` sends reason codes in `card.badges`, shown by
 * `ReasonBadges` with `copy.board.badges`; a package that needs more than a reason adds a
 * component here. A slot renders nothing when it has nothing to show.
 */
export const CARD_BADGE_SLOTS: { key: string; Component: ComponentType<CardBadgeSlotProps> }[] = [
  { key: 'alert-bell', Component: CardAlertBell },
];
