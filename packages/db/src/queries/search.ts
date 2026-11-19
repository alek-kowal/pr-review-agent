// S-17-T5: the command palette's PR search. It only reads.
import { and, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { teamMembers } from '../schema/team.ts';

export type PrSearchHit = {
  repositorySlug: string;
  number: number;
  title: string;
  authorLogin: string;
  /** The Team member's name for the author's login; null when no active member has it. */
  authorName: string | null;
  state: 'open' | 'closed' | 'merged';
};

/** At most this many words of a query are matched. */
const MAX_WORDS = 8;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** A PR number that fits a Postgres integer, from `272` or `#272`; null otherwise. */
function prNumber(word: string): number | null {
  const match = /^#?(\d{1,9})$/.exec(word);
  return match ? Number(match[1]) : null;
}

/**
 * PRs matching every word of `query` on their number, a title word or the author (GitHub login
 * or Team name). An exact number match comes first, then open PRs, then the newest.
 */
export async function searchPullRequests(
  db: Executor,
  query: string,
  limit = 20,
): Promise<PrSearchHit[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
  if (words.length === 0) return [];

  const conditions = words.map((word): SQL => {
    const like = `%${escapeLike(word)}%`;
    const number = prNumber(word);
    return or(
      ilike(pullRequests.title, like),
      ilike(pullRequests.authorLogin, like),
      ilike(teamMembers.name, like),
      ...(number === null ? [] : [eq(pullRequests.number, number)]),
    )!;
  });
  const exact = words.length === 1 ? prNumber(words[0]!) : null;

  return db
    .select({
      repositorySlug: repositories.slug,
      number: pullRequests.number,
      title: pullRequests.title,
      authorLogin: pullRequests.authorLogin,
      authorName: teamMembers.name,
      state: pullRequests.state,
    })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .leftJoin(
      teamMembers,
      and(
        sql`lower(${teamMembers.githubLogin}) = lower(${pullRequests.authorLogin})`,
        isNull(teamMembers.removedAt),
      ),
    )
    .where(and(...conditions))
    .orderBy(
      // Postgres refuses a constant in ORDER BY, so the exact-number key is left out without one.
      ...(exact === null ? [] : [desc(sql`${pullRequests.number} = ${exact}`)]),
      desc(sql`${pullRequests.state} = 'open'`),
      desc(pullRequests.openedAt),
      desc(pullRequests.id),
    )
    .limit(limit);
}
