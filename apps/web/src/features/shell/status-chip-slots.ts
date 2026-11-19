import type { ComponentType } from 'react';
import type { StatusResponse } from '@/lib/api-types.ts';

export type StatusChipProps = { status: StatusResponse };
export type StatusChipSectionProps = StatusChipProps & { close: () => void };

/**
 * The status chip's extension points (from P-12). A package adds one entry:
 * - `CHIP_TONES`: the chip's look by status state (S-10 adds `paused` and `budget`); a state
 *   without an entry looks like `running`.
 * - `CHIP_SEGMENTS`: small marks inside the chip after its text (S-18's alert count).
 * - `CHIP_SECTIONS`: blocks in the chip's popover under today's spend (S-10's pause and budget).
 */
export type ChipTone = 'running' | 'warn' | 'bad';

export const CHIP_TONES: Record<string, ChipTone> = { running: 'running' };

export const CHIP_SEGMENTS: { key: string; Component: ComponentType<StatusChipProps> }[] = [];

export const CHIP_SECTIONS: { key: string; Component: ComponentType<StatusChipSectionProps> }[] =
  [];
