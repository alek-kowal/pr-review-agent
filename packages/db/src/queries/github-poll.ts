// P-28: the GitHub poller's state. The lease keeps two polls from running at once; the seen
// state of each PR moves by compare-and-set, so a transition is handled by one poll only.
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import {
  githubPoller,
  githubPollPullRequests,
  githubPollRepositories,
} from '../schema/github-poll.ts';
import { repositories } from '../schema/repositories.ts';

export type GithubPoller = typeof githubPoller.$inferSelect;
export type PollReason = { code: string; params: Record<string, unknown> };
export type SeenPullRequest = {
  number: number;
  headSha: string;
  isDraft: boolean;
  state: 'open' | 'closed' | 'merged';
  githubUpdatedAt: Date;
};

const EMPTY_POLLER: GithubPoller = {
  id: 1,
  leaseUntil: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  backoffUntil: null,
  rateLimit: null,
};

export async function getGithubPoller(db: Executor): Promise<GithubPoller> {
  const [row] = await db.select().from(githubPoller).where(eq(githubPoller.id, 1));
  return row ?? EMPTY_POLLER;
}

/**
 * Takes the poll lease until `now + leaseMs` when nobody holds it (or it ran out); false when a
 * poll is still running. Taking it records the start.
 */
export async function acquirePollLease(
  db: Executor,
  { now, leaseMs }: { now: Date; leaseMs: number },
): Promise<boolean> {
  await db.insert(githubPoller).values({ id: 1 }).onConflictDoNothing();
  const taken = await db
    .update(githubPoller)
    .set({ leaseUntil: new Date(now.getTime() + leaseMs), lastStartedAt: now })
    .where(
      and(
        eq(githubPoller.id, 1),
        or(isNull(githubPoller.leaseUntil), lte(githubPoller.leaseUntil, now)),
      ),
    )
    .returning({ id: githubPoller.id });
  return taken.length > 0;
}

/** Ends a poll: frees the lease and keeps what the status line shows. */
export async function finishPoll(
  db: Executor,
  result: {
    finishedAt: Date;
    error: PollReason | null;
    backoffUntil: Date | null;
    rateLimit: GithubPoller['rateLimit'];
  },
): Promise<void> {
  await db
    .update(githubPoller)
    .set({
      leaseUntil: null,
      lastFinishedAt: result.finishedAt,
      lastError: result.error,
      backoffUntil: result.backoffUntil,
      ...(result.rateLimit ? { rateLimit: result.rateLimit } : {}),
    })
    .where(eq(githubPoller.id, 1));
}

/** Records why a poll did not start (the backoff), without taking the lease. */
export async function notePollSkipped(db: Executor, error: PollReason): Promise<void> {
  await db.insert(githubPoller).values({ id: 1 }).onConflictDoNothing();
  await db.update(githubPoller).set({ lastError: error }).where(eq(githubPoller.id, 1));
}

export async function getPollRepository(
  db: Executor,
  repositoryId: number,
): Promise<{ baselineAt: Date; lastPolledAt: Date } | null> {
  const [row] = await db
    .select({
      baselineAt: githubPollRepositories.baselineAt,
      lastPolledAt: githubPollRepositories.lastPolledAt,
    })
    .from(githubPollRepositories)
    .where(eq(githubPollRepositories.repositoryId, repositoryId));
  return row ?? null;
}

/** Marks a repository polled; `baseline` also (re)sets its baseline time. */
export async function markRepositoryPolled(
  db: Executor,
  repositoryId: number,
  { at, baseline }: { at: Date; baseline: boolean },
): Promise<void> {
  await db
    .insert(githubPollRepositories)
    .values({ repositoryId, baselineAt: at, lastPolledAt: at })
    .onConflictDoUpdate({
      target: githubPollRepositories.repositoryId,
      set: baseline ? { baselineAt: at, lastPolledAt: at } : { lastPolledAt: at },
    });
}

/** Every connected repository with its poll times (null before its first poll). */
export async function listPollRepositories(db: Executor): Promise<
  {
    repositoryId: number;
    fullName: string;
    baselineAt: Date | null;
    lastPolledAt: Date | null;
    openCount: number;
  }[]
> {
  const open = db
    .select({
      repositoryId: githubPollPullRequests.repositoryId,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(githubPollPullRequests)
    .where(eq(githubPollPullRequests.state, 'open'))
    .groupBy(githubPollPullRequests.repositoryId)
    .as('open');
  const rows = await db
    .select({
      repositoryId: repositories.id,
      fullName: repositories.githubFullName,
      baselineAt: githubPollRepositories.baselineAt,
      lastPolledAt: githubPollRepositories.lastPolledAt,
      openCount: sql<number>`coalesce(${open.count}, 0)`,
    })
    .from(repositories)
    .leftJoin(githubPollRepositories, eq(githubPollRepositories.repositoryId, repositories.id))
    .leftJoin(open, eq(open.repositoryId, repositories.id))
    .orderBy(asc(repositories.githubFullName));
  return rows.map((row) => ({ ...row, openCount: Number(row.openCount) }));
}

export async function seenPullRequests(
  db: Executor,
  repositoryId: number,
): Promise<SeenPullRequest[]> {
  const rows = await db
    .select({
      number: githubPollPullRequests.number,
      headSha: githubPollPullRequests.headSha,
      isDraft: githubPollPullRequests.isDraft,
      state: githubPollPullRequests.state,
      githubUpdatedAt: githubPollPullRequests.githubUpdatedAt,
    })
    .from(githubPollPullRequests)
    .where(eq(githubPollPullRequests.repositoryId, repositoryId));
  return rows as SeenPullRequest[];
}

/** Stores what a baseline saw, over whatever was stored. */
export async function storeSeenPullRequest(
  db: Executor,
  repositoryId: number,
  seen: SeenPullRequest,
): Promise<void> {
  const values = { ...seen, seenAt: new Date() };
  await db
    .insert(githubPollPullRequests)
    .values({ repositoryId, ...values })
    .onConflictDoUpdate({
      target: [githubPollPullRequests.repositoryId, githubPollPullRequests.number],
      set: values,
    });
}

/**
 * Moves a PR's seen state from `expected` to `next` only if it still is `expected` (null: not
 * seen yet). False when another poll moved it first: that poll handles the transition.
 */
export async function advanceSeenPullRequest(
  db: Executor,
  repositoryId: number,
  expected: SeenPullRequest | null,
  next: SeenPullRequest,
): Promise<boolean> {
  const values = { ...next, seenAt: new Date() };
  if (!expected) {
    const inserted = await db
      .insert(githubPollPullRequests)
      .values({ repositoryId, ...values })
      .onConflictDoNothing()
      .returning({ number: githubPollPullRequests.number });
    return inserted.length > 0;
  }
  const updated = await db
    .update(githubPollPullRequests)
    .set(values)
    .where(
      and(
        eq(githubPollPullRequests.repositoryId, repositoryId),
        eq(githubPollPullRequests.number, expected.number),
        eq(githubPollPullRequests.headSha, expected.headSha),
        eq(githubPollPullRequests.isDraft, expected.isDraft),
        eq(githubPollPullRequests.state, expected.state),
      ),
    )
    .returning({ number: githubPollPullRequests.number });
  return updated.length > 0;
}
