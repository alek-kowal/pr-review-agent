// S-19-T1: PR events write the metric source rows (ready, head changes, merge), and the backfill
// writes the same rows from the stored raw events. Own database, handlers called directly.
import {
  eq,
  getPullRequest,
  headChangesOf,
  pullRequestEventsInOrder,
  schema,
  type Repository,
} from '@pra/db';
import { createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { backfillMetricLogs, pushedByBot } from '../src/metrics/metric-logs.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let deps: TestWorkerDeps;
let repository: Repository;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url });
  // Level 1 and a disconnected git mirror do not matter: rounds never run here.
  repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await database?.drop();
});

const sha = (c: string) => c.repeat(40);

test('a PR life cycle on GitHub writes ready, head changes and the merge; the backfill agrees', async () => {
  const fullName = repository.githubFullName;
  const number = 77;
  const pr = (fields: Record<string, unknown>) => ({ number, ...fields });
  // An "Update branch" merge on top of the person's commit.
  deps.github.addCommit(fullName, {
    sha: sha('5'),
    parents: [sha('3'), sha('9')],
    message: "Merge branch 'main' into edge-labels",
  });

  const events = [
    await storeGithubEvent(deps, 'pull_request.opened', {
      fullName,
      headSha: sha('2'),
      pullRequest: pr({ updated_at: '2026-11-18T10:00:00Z' }),
    }),
    // A person's push: the fixture's sender is the user `wb-dev`.
    await storeGithubEvent(deps, 'pull_request.synchronize', {
      fullName,
      headSha: sha('3'),
      pullRequest: pr({ updated_at: '2026-11-18T11:00:00Z' }),
    }),
    await storeGithubEvent(deps, 'pull_request.synchronize', {
      fullName,
      headSha: sha('5'),
      pullRequest: pr({ updated_at: '2026-11-18T12:00:00Z' }),
      payload: { before: sha('3'), after: sha('5') },
    }),
    await storeGithubEvent(deps, 'pull_request.synchronize', {
      fullName,
      headSha: sha('6'),
      pullRequest: pr({ updated_at: '2026-11-18T12:30:00Z' }),
      payload: {
        before: sha('5'),
        after: sha('6'),
        sender: { login: 'pr-review-agent[bot]', type: 'Bot' },
      },
    }),
    await storeGithubEvent(deps, 'pull_request.closed', {
      fullName,
      headSha: sha('6'),
      pullRequest: pr({
        updated_at: '2026-11-18T13:00:00Z',
        merged: true,
        merged_at: '2026-11-18T13:00:00Z',
        merge_commit_sha: sha('7'),
      }),
    }),
  ];
  for (const event of events) await processGithubEvent(deps, event.id);

  const stored = await getPullRequest(deps.db, repository.id, number);
  expect(stored).toMatchObject({
    state: 'merged',
    readyAt: events[0]!.receivedAt,
    mergedAt: new Date('2026-11-18T13:00:00Z'),
    closedAt: new Date('2026-11-18T13:00:00Z'),
    mergeSha: sha('7'),
  });
  const rows = (changes: Awaited<ReturnType<typeof headChangesOf>>) =>
    changes.map((c) => [c.beforeSha, c.afterSha, c.pusher, c.byBot, c.isBaseMerge]);
  const live = rows(await headChangesOf(deps.db, stored!.id));
  expect(live).toEqual([
    [sha('2'), sha('3'), 'wb-dev', false, false],
    [sha('3'), sha('5'), 'wb-dev', false, true],
    [sha('5'), sha('6'), 'pr-review-agent[bot]', true, false],
  ]);
  // A bot's push needs no commit lookup.
  expect(deps.github.callsOf('getCommit').map(([, s]) => s)).toEqual([sha('3'), sha('5')]);

  // The backfill from the raw events gives the same rows, and a second run adds nothing.
  await deps.db.delete(schema.headChanges);
  await deps.db
    .update(schema.pullRequests)
    .set({ readyAt: null, closedAt: null, mergedAt: null, mergeSha: null })
    .where(eq(schema.pullRequests.id, stored!.id));
  const first = await backfillMetricLogs(deps, await pullRequestEventsInOrder(deps.db));
  expect(first).toMatchObject({ ready: 1, headChanges: 3, closed: 1 });
  expect(rows(await headChangesOf(deps.db, stored!.id))).toEqual(live);
  expect(await getPullRequest(deps.db, repository.id, number)).toMatchObject({
    readyAt: events[0]!.receivedAt,
    mergedAt: new Date('2026-11-18T13:00:00Z'),
    mergeSha: sha('7'),
  });
  const again = await backfillMetricLogs(deps, await pullRequestEventsInOrder(deps.db));
  expect(again.headChanges).toBe(0);
  expect(await headChangesOf(deps.db, stored!.id)).toHaveLength(3);
});

test('a bot is a sender of type Bot or a login ending in [bot]', () => {
  expect(pushedByBot({ login: 'wb-dev', type: 'User' })).toBe(false);
  expect(pushedByBot({ login: 'dependabot[bot]', type: 'User' })).toBe(true);
  expect(pushedByBot({ login: 'pr-review-agent', type: 'Bot' })).toBe(true);
  expect(pushedByBot(undefined)).toBe(false);
});
