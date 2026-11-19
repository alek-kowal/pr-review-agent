import type { ComponentType } from 'react';
import { AlertsSection } from '@/features/alerts/AlertsSection.tsx';
import { CancelRowAction } from '@/features/runs/CancelAction.tsx';
import type { InProgressRun } from '@/lib/api-types.ts';

/**
 * The Activity page's extension points (from P-12). A package adds one entry:
 * - `ACTIVITY_SECTIONS`: sections above (`before`, S-18's Alerts) or below (`after`, S-18's
 *   Finished today) the In progress table.
 * - `IN_PROGRESS_ROW_ACTIONS`: buttons at the end of an In progress row (S-09's Cancel).
 */
export const ACTIVITY_SECTIONS: {
  key: string;
  position: 'before' | 'after';
  Component: ComponentType;
}[] = [{ key: 'alerts', position: 'before', Component: AlertsSection }];

export const IN_PROGRESS_ROW_ACTIONS: {
  key: string;
  Component: ComponentType<{ run: InProgressRun }>;
}[] = [{ key: 'cancel', Component: CancelRowAction }];
