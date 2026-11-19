import type { ActorKind } from '@pra/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { settingsChanges } from '../schema/settings-changes.ts';

export type SettingsChange = typeof settingsChanges.$inferSelect;
export type NewSettingsChange = {
  area: string;
  entity: string;
  actor: ActorKind;
  /** Required exactly when `actor` is `member`. */
  signerId?: string | null;
  before: unknown;
  after: unknown;
  note?: string | null;
  at?: Date;
};

/** Writes one log row. Signed changes use the api's `applySignedSettingsChange`, not this. */
export async function insertSettingsChange(
  db: Executor,
  change: NewSettingsChange,
): Promise<SettingsChange> {
  const [row] = await db
    .insert(settingsChanges)
    .values({
      ...change,
      signerId: change.signerId ?? null,
      before: change.before ?? null,
      after: change.after ?? null,
    })
    .returning();
  return row!;
}

/** Log rows, newest first, optionally of one area or one entity. */
export async function listSettingsChanges(
  db: Executor,
  filter: { area?: string; entity?: string; limit?: number } = {},
): Promise<SettingsChange[]> {
  return db
    .select()
    .from(settingsChanges)
    .where(
      and(
        filter.area === undefined ? undefined : eq(settingsChanges.area, filter.area),
        filter.entity === undefined ? undefined : eq(settingsChanges.entity, filter.entity),
      ),
    )
    .orderBy(desc(settingsChanges.at), desc(settingsChanges.id))
    .limit(filter.limit ?? 100);
}
