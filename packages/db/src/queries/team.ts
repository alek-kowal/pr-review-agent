import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { teamMembers } from '../schema/team.ts';

export type TeamMember = typeof teamMembers.$inferSelect;
export type TeamMemberFields = {
  name: string;
  githubLogin: string;
  clickupUserId?: string | null;
};

/** Active members by name; `includeRemoved` adds removed ones (for names on past signatures). */
export async function listTeamMembers(
  db: Executor,
  options: { includeRemoved?: boolean } = {},
): Promise<TeamMember[]> {
  return db
    .select()
    .from(teamMembers)
    .where(options.includeRemoved ? undefined : isNull(teamMembers.removedAt))
    .orderBy(asc(sql`lower(${teamMembers.name})`), asc(teamMembers.createdAt));
}

/** A member by id, removed or not. */
export async function getTeamMember(db: Executor, id: string): Promise<TeamMember | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  return row;
}

/** A member by id while they are in the team. */
export async function getActiveTeamMember(
  db: Executor,
  id: string,
): Promise<TeamMember | undefined> {
  const member = await getTeamMember(db, id);
  return member && !member.removedAt ? member : undefined;
}

export async function countActiveTeamMembers(db: Executor): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(teamMembers)
    .where(isNull(teamMembers.removedAt));
  return row?.n ?? 0;
}

/** The active member with this GitHub login (case-insensitive). */
export async function findActiveMemberByGithubLogin(
  db: Executor,
  githubLogin: string,
): Promise<TeamMember | undefined> {
  const [row] = await db
    .select()
    .from(teamMembers)
    .where(
      and(
        isNull(teamMembers.removedAt),
        sql`lower(${teamMembers.githubLogin}) = lower(${githubLogin})`,
      ),
    );
  return row;
}

/** Fails with a unique violation on `team_members_github_login_active` for a taken login. */
export async function insertTeamMember(
  db: Executor,
  fields: TeamMemberFields,
): Promise<TeamMember> {
  const [row] = await db.insert(teamMembers).values(fields).returning();
  return row!;
}

/** Updates an active member; undefined when there is none. */
export async function updateTeamMember(
  db: Executor,
  id: string,
  patch: Partial<TeamMemberFields>,
): Promise<TeamMember | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db
    .update(teamMembers)
    .set(patch)
    .where(and(eq(teamMembers.id, id), isNull(teamMembers.removedAt)))
    .returning();
  return row;
}

/** Soft removal: the row stays, so past signatures keep their name. */
export async function removeTeamMember(
  db: Executor,
  id: string,
  at: Date = new Date(),
): Promise<TeamMember | undefined> {
  if (!isUuid(id)) return undefined;
  const [row] = await db
    .update(teamMembers)
    .set({ removedAt: at })
    .where(and(eq(teamMembers.id, id), isNull(teamMembers.removedAt)))
    .returning();
  return row;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Member ids are uuids; anything else would make Postgres fail the query. */
export const isUuid = (value: string): boolean => UUID.test(value);
