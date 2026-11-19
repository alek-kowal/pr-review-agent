import type { ComponentType } from 'react';
import type { FindingView, FindingsResponse, PrView } from '@/lib/api-types.ts';
import { FollowUpLine } from '@/features/clickup/FollowUpLine.tsx';
import { FixBadge, FixNote } from '@/features/rounds/FixStatus.tsx';
import { DecideRow, DecisionBadge } from './DecisionSlots.tsx';

export type FindingSlotProps = {
  finding: FindingView;
  /** The round the findings come from (the latest completed one). */
  round: NonNullable<FindingsResponse['round']>;
  repo: string;
  number: string;
  view: PrView;
};

export type FindingSlot = { key: string; Component: ComponentType<FindingSlotProps> };

/**
 * `Finding` line slots (extension point from P-04): small items on the finding's collapsed line,
 * before the verdict. Decision and fix-result badges (P-08), opinions and drafts go here. Only
 * decisions and fix results carry a badge (FR-036); anything else is grey text. A package adds
 * one entry; a slot renders nothing when it has nothing to show.
 */
export const FINDING_LINE_SLOTS: FindingSlot[] = [
  { key: 'decision', Component: DecisionBadge },
  { key: 'fix', Component: FixBadge },
];

/**
 * `Finding` action slots (extension point from P-04): rows at the bottom of an open finding, in
 * order. Opinion and decision forms (P-08) and implementer actions (P-18) go here. A finding
 * deferred to ClickUp shows its follow-up task first (S-06-T5).
 */
export const FINDING_ACTION_SLOTS: FindingSlot[] = [
  { key: 'fix-note', Component: FixNote },
  { key: 'follow-up', Component: FollowUpLine },
  { key: 'decide', Component: DecideRow },
];
