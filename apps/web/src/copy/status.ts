// The status chip in the top bar: the factory's state and today's spend.
import { money } from './format.ts';

export const status = {
  label: 'Factory status',
  /** The chip's text by status state; S-10 adds paused and budget. */
  states: {
    running: (spentUsd: number) => `Running · ${money(spentUsd)} today`,
  } as Record<string, (spentUsd: number) => string>,
  unknownState: (state: string, spentUsd: number) => `${state} · ${money(spentUsd)} today`,
  spentToday: 'Spent today',
  spentHint: 'Real spend only: what agent sessions cost since midnight UTC.',
  openActivity: 'Open Activity',
};
