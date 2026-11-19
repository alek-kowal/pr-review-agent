import type { ComponentType } from 'react';
import type { MainActionCode } from '@pra/core';
import type { NextStepView, PrView } from '@/lib/api-types.ts';
import { RoundProgress } from '@/features/round/RoundProgress.tsx';
import { Checklist } from './Checklist.tsx';
import { DecideAction } from './DecideAction.tsx';
import type { PrTabProps } from './tabs.ts';

export type PrSlotProps = PrTabProps;
export type MainActionProps = PrSlotProps & { action: NonNullable<NextStepView['mainAction']> };
export type PrSlot = { key: string; Component: ComponentType<PrSlotProps> };
export type PrPanel = PrSlot & { shows: (view: PrView) => boolean };

/**
 * The Next step banner's main action by core's main action code (extension point from P-08). A
 * code without an entry shows no button: its slice adds the entry with its component.
 */
export const MAIN_ACTIONS: Partial<Record<MainActionCode, ComponentType<MainActionProps>>> = {
  decide: DecideAction,
};

/**
 * Secondary lines inside the Next step banner, under its title (extension point from P-08): PR
 * alerts, the live cost counter, a failure's details. A line renders nothing when it has nothing.
 */
export const BANNER_LINES: PrSlot[] = [{ key: 'round-progress', Component: RoundProgress }];

/**
 * Panels in the PR page's side column, in order (extension point from P-08). The column shows
 * only when a panel `shows` for the PR; on narrow screens it sits between the banner and the tabs.
 */
export const PR_PANELS: PrPanel[] = [
  { key: 'checklist', Component: Checklist, shows: (view) => view.nextStep.lane !== null },
];

/** Quiet buttons in the PR header, before the GitHub link (extension point from P-08). */
export const PR_HEADER_ACTIONS: PrSlot[] = [];
