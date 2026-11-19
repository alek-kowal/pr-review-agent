// S-17-T3: the board's filters. Everything here only reads.
import { eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { prTaskLinks } from '../schema/clickup.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { answers, opinions, reviews } from '../schema/reviews.ts';
import { runs } from '../schema/runs.ts';
import { sensitiveFiles } from '../schema/sensitive-files.ts';
import { decisionBatches, teamMembers } from '../schema/team.ts';
import { timelineEntries } from '../schema/timeline.ts';

/**
 * The PRs a Team member signed anything on, as PR ids: decisions, opinions, signed reviews,
 * answers, sensitive file approvals, signed review starts, task links, and every signed timeline
 * entry (merges from the app, and pushes once they land, write one). Undone decisions count:
 * the member still signed them.
 */
export async function prsSignedBy(db: Executor, memberId: string): Promise<number[]> {
  const result = await db.execute<{ id: number }>(sql`
    select ${decisionBatches.pullRequestId} as id from ${decisionBatches}
      where ${decisionBatches.signedBy} = ${memberId}
    union select ${opinions.pullRequestId} from ${opinions}
      where ${opinions.signedBy} = ${memberId}
    union select ${reviews.pullRequestId} from ${reviews}
      where ${reviews.signedBy} = ${memberId}
    union select ${answers.pullRequestId} from ${answers}
      where ${answers.signedBy} = ${memberId}
    union select ${sensitiveFiles.pullRequestId} from ${sensitiveFiles}
      where ${sensitiveFiles.memberId} = ${memberId}
    union select ${runs.pullRequestId} from ${runs}
      where ${runs.startedByMemberId} = ${memberId}
    union select ${prTaskLinks.pullRequestId} from ${prTaskLinks}
      where ${prTaskLinks.linkedByMemberId} = ${memberId}
    union select ${timelineEntries.pullRequestId} from ${timelineEntries}
      where ${timelineEntries.memberId} = ${memberId}
  `);
  return result.rows.map((row) => Number(row.id));
}

/** The board filters the database applies; the level is applied on the loaded state. */
export type BoardFilter = {
  /** A Team member's GitHub login: PRs they authored or signed anything on. */
  person?: string;
  /** A repository slug. */
  repo?: string;
  forks?: 'hide' | 'only';
  drafts?: 'hide';
};

/** The `where` conditions for a board filter, ANDed together; none when nothing is filtered. */
export async function boardFilterConditions(db: Executor, filter: BoardFilter): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (filter.person !== undefined) {
    // A removed member keeps their past signatures, so every member with the login counts.
    const members = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(sql`lower(${teamMembers.githubLogin}) = lower(${filter.person})`);
    const signed = [
      ...new Set((await Promise.all(members.map((m) => prsSignedBy(db, m.id)))).flat()),
    ];
    const authored = sql`lower(${pullRequests.authorLogin}) = lower(${filter.person})`;
    conditions.push(signed.length ? or(authored, inArray(pullRequests.id, signed))! : authored);
  }
  if (filter.repo !== undefined) {
    const repository = db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.slug, filter.repo));
    conditions.push(inArray(pullRequests.repositoryId, repository));
  }
  if (filter.forks === 'hide') conditions.push(eq(pullRequests.isFork, false));
  if (filter.forks === 'only') conditions.push(eq(pullRequests.isFork, true));
  if (filter.drafts === 'hide') conditions.push(eq(pullRequests.isDraft, false));
  return conditions;
}
