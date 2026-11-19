import {
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  parseWithFallback,
  type AppSettings,
  type Parsed,
} from '@pra/core';
import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { appSettings } from '../schema/repositories.ts';

const ROW_ID = 1;

/** Inserts the defaults row when there is none; an existing row is left as it is. */
export async function ensureAppSettings(db: Executor): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: ROW_ID, settings: DEFAULT_APP_SETTINGS })
    .onConflictDoNothing({ target: appSettings.id });
}

/**
 * The app settings. A broken field falls back to its default with a warning; a missing row
 * reads as the defaults.
 */
export async function getAppSettings(db: Executor): Promise<Parsed<AppSettings>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, ROW_ID));
  if (!row) return { value: DEFAULT_APP_SETTINGS, warnings: [] };
  return parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, row.settings);
}
