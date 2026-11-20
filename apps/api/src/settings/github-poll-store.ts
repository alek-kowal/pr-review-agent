import type { GitHubPollSchedule } from '@pra/core';
import { lockAppSettings, writeAppSettings } from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

/** The GitHub poll schedule's entity in the Audit log (area `integrations`, P-28). */
export const GITHUB_POLL_ENTITY = 'github_poll';

/**
 * The poll schedule in Settings → Integrations: its own store, so a logged change shows only the
 * schedule and the after-round comment switch stays as it is.
 */
export function githubPollStore(): SettingsStore<GitHubPollSchedule> {
  return {
    area: 'integrations',
    async read(tx) {
      return (await lockAppSettings(tx)).githubPoll;
    },
    async write(tx, entity, after) {
      if (after === null) throw new Error('the poll schedule cannot be removed');
      const current = await lockAppSettings(tx);
      const stored = await writeAppSettings(tx, { ...current, githubPoll: after });
      return { entity, value: stored.githubPoll };
    },
  };
}
