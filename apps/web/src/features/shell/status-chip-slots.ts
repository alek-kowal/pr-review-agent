import type { ComponentType } from 'react';
import { ChipAlertCount } from '@/features/alerts/ChipAlertCount.tsx';
import { StatusControls } from '@/features/budget/StatusControls.tsx';
import type { StatusResponse } from '@/lib/api-types.ts';

export type StatusChipProps = { status: StatusResponse };
export type StatusChipSectionProps = StatusChipProps & { close: () => void };

/**
 * The status chip's extension points (from P-12). A package adds one entry:
 * - `CHIP_TONES`: the chip's look by status state; a state without an entry looks like `running`.
 * - `CHIP_SEGMENTS`: small marks inside the chip after its text (S-18's alert count).
 * - `CHIP_SECTIONS`: blocks in the chip's popover under today's spend (S-10's pause and budget).
 */
export type ChipTone = 'running' | 'warn' | 'bad';

export const CHIP_TONES: Record<string, ChipTone> = {
  running: 'running',
  paused: 'warn',
  budget_reached: 'bad',
};

export const CHIP_SEGMENTS: { key: string; Component: ComponentType<StatusChipProps> }[] = [
  { key: 'alerts', Component: ChipAlertCount },
];

export const CHIP_SECTIONS: { key: string; Component: ComponentType<StatusChipSectionProps> }[] = [
  { key: 'pause-budget', Component: StatusControls },
];
