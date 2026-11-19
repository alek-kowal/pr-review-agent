import type { ActorKind } from '@pra/core';
import { and, asc, desc, eq, gte, isNotNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { settingsChanges } from '../schema/settings-changes.ts';
import { teamMembers } from '../schema/team.ts';

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

/** Who made a change, for the audit filter: the bot, by hand, or one signer (a member id). */
export type AuditActorFilter = { kind: 'bot' } | { kind: 'hand' } | { kind: 'member'; id: string };

export type AuditFilter = {
  /** Matched case-insensitively against the area, entity, actor, signer name, note and values. */
  q?: string;
  area?: string;
  actor?: AuditActorFilter;
  /** Inclusive lower bound of `at`. */
  from?: Date;
  /** Exclusive upper bound of `at`. */
  to?: Date;
  /** The id of the last row of the previous page; the page continues after it. */
  after?: number;
  limit: number;
};

export type AuditEntry = SettingsChange & { signerName: string | null };

/**
 * The Audit log (S-21-T6): settings changes, the bot's own included, newest first. Pages are
 * keyset-paginated on (at, id), so rows written while someone pages never shift or repeat a page.
 */
export async function searchSettingsChanges(
  db: Executor,
  filter: AuditFilter,
): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
  const conditions: (SQL | undefined)[] = [
    filter.area === undefined ? undefined : eq(settingsChanges.area, filter.area),
    actorCondition(filter.actor),
    filter.from === undefined ? undefined : gte(settingsChanges.at, filter.from),
    filter.to === undefined ? undefined : lt(settingsChanges.at, filter.to),
    searchCondition(filter.q),
    filter.after === undefined
      ? undefined
      : sql`(${settingsChanges.at}, ${settingsChanges.id}) < (select c.at, c.id from settings_changes c where c.id = ${filter.after})`,
  ];
  const rows = await db
    .select({ change: settingsChanges, signerName: teamMembers.name })
    .from(settingsChanges)
    .leftJoin(teamMembers, eq(teamMembers.id, settingsChanges.signerId))
    .where(and(...conditions))
    .orderBy(desc(settingsChanges.at), desc(settingsChanges.id))
    .limit(filter.limit + 1);
  return {
    entries: rows
      .slice(0, filter.limit)
      .map((row) => ({ ...row.change, signerName: row.signerName })),
    hasMore: rows.length > filter.limit,
  };
}

/** The areas and signers that appear in the log, for the Audit log's filters. */
export async function settingsChangeFacets(
  db: Executor,
): Promise<{ areas: string[]; signers: { id: string; name: string }[] }> {
  const [areas, signers] = await Promise.all([
    db
      .select({ area: settingsChanges.area })
      .from(settingsChanges)
      .groupBy(settingsChanges.area)
      .orderBy(asc(settingsChanges.area)),
    db
      .select({ id: teamMembers.id, name: teamMembers.name })
      .from(settingsChanges)
      .innerJoin(teamMembers, eq(teamMembers.id, settingsChanges.signerId))
      .where(isNotNull(settingsChanges.signerId))
      .groupBy(teamMembers.id, teamMembers.name)
      .orderBy(asc(teamMembers.name), asc(teamMembers.id)),
  ]);
  return { areas: areas.map((row: { area: string }) => row.area), signers };
}

function actorCondition(actor: AuditActorFilter | undefined): SQL | undefined {
  if (!actor) return undefined;
  if (actor.kind === 'member') {
    return and(eq(settingsChanges.actor, 'member'), eq(settingsChanges.signerId, actor.id));
  }
  return eq(settingsChanges.actor, actor.kind);
}

function searchCondition(q: string | undefined): SQL | undefined {
  const text = q?.trim();
  if (!text) return undefined;
  // LIKE wildcards in the search text match themselves.
  const pattern = `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return or(
    sql`${settingsChanges.area} ilike ${pattern}`,
    sql`${settingsChanges.entity} ilike ${pattern}`,
    sql`${settingsChanges.actor} ilike ${pattern}`,
    sql`${teamMembers.name} ilike ${pattern}`,
    sql`${settingsChanges.note} ilike ${pattern}`,
    sql`${settingsChanges.before}::text ilike ${pattern}`,
    sql`${settingsChanges.after}::text ilike ${pattern}`,
  );
}
