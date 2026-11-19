import type { ComponentType } from 'react';
import { RunDetailsLink } from '@/features/runs/RunDetailsLink.tsx';

/** Links after the round line (Run details, S-03-T10). */
export const ROUND_LINE_LINKS: { key: string; Component: ComponentType<{ runId: number }> }[] = [
  { key: 'run-details', Component: RunDetailsLink },
];
