// S-10-T4: pause, daily budget and agent slots as Settings areas of the one app settings row.
// Area `budget` with three entities, so each logged change shows only its own fields.
import type { AppSettings } from '@pra/core';
import { lockAppSettings, writeAppSettings, type Executor } from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

export const BUDGET_AREA = 'budget';

/** Paused or running; `by` is the signing Team member's id. */
export type PauseState = { paused: boolean; reason: string | null; by: string | null };
export type DailyBudget = { dailyBudgetUsd: number | null };
export type AgentSlots = { agentSlots: number };

export const pauseStateOf = (settings: AppSettings): PauseState => ({
  paused: settings.paused,
  reason: settings.pausedReason,
  by: settings.pausedBy,
});

export const dailyBudgetOf = (settings: AppSettings): DailyBudget => ({
  dailyBudgetUsd: settings.dailyBudgetUsd,
});

export const agentSlotsOf = (settings: AppSettings): AgentSlots => ({
  agentSlots: settings.agentSlots,
});

/** One entity's fields of the app settings row; the other fields stay as they are. */
function appSettingsStore<T>(
  entity: string,
  pick: (settings: AppSettings) => T,
  apply: (settings: AppSettings, after: T) => AppSettings,
): SettingsStore<T> {
  return {
    area: BUDGET_AREA,
    async read(tx: Executor) {
      return pick(await lockAppSettings(tx));
    },
    async write(tx, written, after) {
      if (after === null) throw new Error(`the ${entity} setting cannot be removed`);
      const stored = await writeAppSettings(tx, apply(await lockAppSettings(tx), after));
      return { entity: written, value: pick(stored) };
    },
  };
}

export const STATUS_ENTITY = 'status';
export const DAILY_BUDGET_ENTITY = 'daily_budget';
export const AGENT_SLOTS_ENTITY = 'agent_slots';

/** Pause and resume; pausing stamps `pausedAt`, resuming clears it. */
export const statusStore = (now: () => Date = () => new Date()) =>
  appSettingsStore<PauseState>(STATUS_ENTITY, pauseStateOf, (settings, after) => ({
    ...settings,
    paused: after.paused,
    pausedReason: after.paused ? after.reason : null,
    pausedBy: after.paused ? after.by : null,
    pausedAt: after.paused ? now().toISOString() : null,
  }));

export const dailyBudgetStore = () =>
  appSettingsStore<DailyBudget>(DAILY_BUDGET_ENTITY, dailyBudgetOf, (settings, after) => ({
    ...settings,
    dailyBudgetUsd: after.dailyBudgetUsd,
  }));

export const agentSlotsStore = () =>
  appSettingsStore<AgentSlots>(AGENT_SLOTS_ENTITY, agentSlotsOf, (settings, after) => ({
    ...settings,
    agentSlots: after.agentSlots,
  }));
