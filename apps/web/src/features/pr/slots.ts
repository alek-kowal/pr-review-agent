import type { ComponentType } from 'react';
import type { MainActionCode } from '@pra/core';
import type { NextStepView, PrView } from '@/lib/api-types.ts';
import { ResumeAction } from '@/features/budget/ResumeAction.tsx';
import { ChangeTypePanel } from '@/features/checks/ChangeTypePanel.tsx';
import { TaskPanel } from '@/features/clickup/TaskPanel.tsx';
import { MergeAction } from '@/features/merge/MergeAction.tsx';
import { RoundProgress } from '@/features/round/RoundProgress.tsx';
import { CancelAction } from '@/features/runs/CancelAction.tsx';
import { RetryAction } from '@/features/runs/RetryAction.tsx';
import { Checklist } from './Checklist.tsx';
import { DecideAction } from './DecideAction.tsx';
import { StartReviewHeaderAction, StartReviewMainAction } from '@/features/rounds/StartReview.tsx';
import { SensitiveAction } from '@/features/sensitive/SensitiveAction.tsx';
import { SensitiveBannerLine, SensitivePanel } from '@/features/sensitive/SensitivePanel.tsx';
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
  start_review: StartReviewMainAction,
  approve_sensitive: SensitiveAction,
  retry: RetryAction,
  cancel: CancelAction,
  resume: ResumeAction,
  merge: MergeAction,
};

/**
 * Secondary lines inside the Next step banner, under its title (extension point from P-08): PR
 * alerts, the live cost counter, a failure's details. A line renders nothing when it has nothing.
 */
export const BANNER_LINES: PrSlot[] = [
  { key: 'round-progress', Component: RoundProgress },
  { key: 'sensitive', Component: SensitiveBannerLine },
];

/**
 * Panels in the PR page's side column, in order (extension point from P-08). The column shows
 * only when a panel `shows` for the PR; on narrow screens it sits between the banner and the tabs.
 */
export const PR_PANELS: PrPanel[] = [
  { key: 'checklist', Component: Checklist, shows: (view) => view.nextStep.lane !== null },
  { key: 'sensitive', Component: SensitivePanel, shows: (view) => view.sensitive.files.length > 0 },
  { key: 'clickup-task', Component: TaskPanel, shows: (view) => view.pullRequest.state === 'open' },
  {
    key: 'change-type',
    Component: ChangeTypePanel,
    shows: (view) =>
      view.pullRequest.state === 'open' || view.checks.changeType !== null || !!view.checks.largePr,
  },
];

/** Quiet buttons in the PR header, before the GitHub link (extension point from P-08). */
export const PR_HEADER_ACTIONS: PrSlot[] = [
  { key: 'start-review', Component: StartReviewHeaderAction },
];
