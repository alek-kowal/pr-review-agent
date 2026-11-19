import type { ComponentType } from 'react';
import { copy } from '@/copy/index.ts';
import type { PrView } from '@/lib/api-types.ts';
import { FindingsTab } from '@/features/findings/FindingsTab.tsx';
import { PatchTab, QuestionsTab, TimelineTab } from './tab-panels.tsx';

export type PrTabProps = { repo: string; number: string; view: PrView };

export type PrTab = {
  /** The `?tab=` value. */
  key: string;
  label: string;
  Panel: ComponentType<PrTabProps>;
};

/**
 * The PR page tabs, in order (extension point from P-04): a package adds a tab with one entry.
 * The first tab is the default when the URL has no valid `?tab=`.
 */
export const PR_TABS: readonly PrTab[] = [
  { key: 'findings', label: copy.pr.tabs.findings, Panel: FindingsTab },
  { key: 'questions', label: copy.pr.tabs.questions, Panel: QuestionsTab },
  { key: 'patch', label: copy.pr.tabs.patch, Panel: PatchTab },
  { key: 'timeline', label: copy.pr.tabs.timeline, Panel: TimelineTab },
];

export const DEFAULT_PR_TAB = PR_TABS[0]!.key;

export const isPrTab = (key: unknown): key is string =>
  typeof key === 'string' && PR_TABS.some((tab) => tab.key === key);
