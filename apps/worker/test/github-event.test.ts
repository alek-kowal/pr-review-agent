// S-01-T6: the `github.event` handler and round 1. Handlers run directly on the shared test
// database; jobs are counted by this file's own run ids.
import {
  eq,
  getGithubEvent,
  getPullRequest,
  getRepositoryByFullName,
  insertRepository,
  JOBS,
  schema,
  sql,
  type Repository,
} from '@pra/db';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  jobsWhere,
  storeGithubEvent,
  type StoreEventOptions,
} from './support.ts';
import type { GitHubFixtureName } from '@pra/integrations/testing';

const deps = await createTestWorkerDeps();
let repository: Repository;

beforeEach(async () => {
  repository = await connectRepository(deps.db);
});

afterAll(() => deps.close());

async function deliver(
  name: GitHubFixtureName,
  options: Partial<StoreEventOptions> = {},
): Promise<string> {
  const event = await storeGithubEvent(deps, name, {
    fullName: repository.githubFullName,
    ...options,
  });
  return processGithubEvent(deps, event.id);
}

async function runsOf(prNumber: number) {
  const pr = await getPullRequest(deps.db, repository.id, prNumber);
  if (!pr) return [];
  return deps.db.select().from(schema.runs).where(eq(schema.runs.pullRequestId, pr.id));
}

describe('a repository connected in Settings', () => {
  test('gets its PR row from the next webhook, with no worker restart', async () => {
    const fullName = `acme-${repository.id}/second-repo`;
    expect(await deliver('pull_request.ready_for_review', { fullName })).toBe(
      'repository_not_connected',
    );

    // What `POST /api/settings/repositories` writes, while these deps (the worker) keep running.
    const connected = await insertRepository(
      deps.db,
      { slug: `second-repo-${repository.id}`, githubFullName: fullName, defaultLevel: 2 },
      2,
    );

    expect(await deliver('pull_request.ready_for_review', { fullName })).toBe('round_started');
    expect(await getPullRequest(deps.db, connected.id, 312)).toMatchObject({
      repositoryId: connected.id,
      number: 312,
    });
  });
});

describe('round 1 from a webhook', () => {
  test('ready_for_review on a PR that is not a fork gives one queued run and one stage job', async () => {
    expect(await deliver('pull_request.ready_for_review')).toBe('round_started');

    const runs = await runsOf(312);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toMatchObject({
      kind: 'round',
      roundNo: 1,
      status: 'queued',
      startedBy: 'bot',
      trigger: 'ready_for_review',
      headSha: '2'.repeat(40),
      commitsCountAtStart: 2,
    });
    expect(run!.level.number).toBe(1);

    const jobs = await jobsWhere(deps.db, JOBS.runStage, 'runId', run!.id);
    expect(jobs).toEqual([
      expect.objectContaining({
        data: { runId: run!.id, stage: 'review' },
        singletonKey: `${run!.id}:review`,
      }),
    ]);
  });

  test('the level is frozen from the repository default', async () => {
    repository = await connectRepository(deps.db, { defaultLevel: 2 });

    expect(await deliver('pull_request.ready_for_review')).toBe('round_started');

    const [run] = await runsOf(312);
    expect(run!.level.number).toBe(2);
  });

  test('a PR opened as a draft gets no run, with outcome draft', async () => {
    expect(await deliver('pull_request.opened-draft')).toBe('draft');
    expect(await runsOf(312)).toEqual([]);
    expect((await getPullRequest(deps.db, repository.id, 312))?.isDraft).toBe(true);
  });

  test('a fork gets no run, with outcome fork', async () => {
    expect(await deliver('pull_request.opened-fork')).toBe('fork');
    const pr = await getPullRequest(deps.db, repository.id, 313);
    expect(pr?.isFork).toBe(true);
    expect(await runsOf(313)).toEqual([]);
  });

  test('synchronize updates head_sha and starts nothing', async () => {
    await deliver('pull_request.opened-draft');

    expect(await deliver('pull_request.synchronize')).toBe('push_never_starts');

    const pr = await getPullRequest(deps.db, repository.id, 312);
    expect(pr?.headSha).toBe('3'.repeat(40));
    expect(await runsOf(312)).toEqual([]);
  });

  test('the same event twice gives one run', async () => {
    const event = await storeGithubEvent(deps, 'pull_request.ready_for_review', {
      fullName: repository.githubFullName,
    });

    expect(await processGithubEvent(deps, event.id)).toBe('round_started');
    expect(await processGithubEvent(deps, event.id)).toBe('round_started');

    const runs = await runsOf(312);
    expect(runs).toHaveLength(1);
    expect(await jobsWhere(deps.db, JOBS.runStage, 'runId', runs[0]!.id)).toHaveLength(1);
  });

  test('a second delivery while round 1 is queued starts nothing', async () => {
    await deliver('pull_request.ready_for_review');

    expect(await deliver('pull_request.ready_for_review')).toBe('run_active');
    expect(await runsOf(312)).toHaveLength(1);
  });

  test('two deliveries at once start one round', async () => {
    const store = () =>
      storeGithubEvent(deps, 'pull_request.ready_for_review', {
        fullName: repository.githubFullName,
      });
    const [first, second] = [await store(), await store()];

    const outcomes = await Promise.all([
      processGithubEvent(deps, first.id),
      processGithubEvent(deps, second.id),
    ]);

    expect(outcomes.sort()).toEqual(['round_started', 'run_active']);
    expect(await runsOf(312)).toHaveLength(1);
  });

  test('the outcome and installation id are recorded', async () => {
    const event = await storeGithubEvent(deps, 'pull_request.ready_for_review', {
      fullName: repository.githubFullName,
    });
    await processGithubEvent(deps, event.id);

    const stored = await getGithubEvent(deps.db, event.id);
    expect(stored).toMatchObject({ outcome: 'round_started' });
    expect(stored?.processedAt).toBeInstanceOf(Date);
    const repo = await getRepositoryByFullName(deps.db, repository.githubFullName);
    expect(repo?.installationId).toBe(55500001);
  });
});

describe('other outcomes', () => {
  test('a repository that is not connected is ignored', async () => {
    const outcome = await deliver('pull_request.ready_for_review', {
      fullName: `acme/not-connected-${repository.slug}`,
    });
    expect(outcome).toBe('repository_not_connected');
  });

  test('an event type without a handler is recorded as event_ignored', async () => {
    const event = await storeGithubEvent(deps, 'ping', { fullName: repository.githubFullName });
    await deps.db
      .update(schema.githubEvents)
      .set({ event: 'issues' })
      .where(eq(schema.githubEvents.id, event.id));

    expect(await processGithubEvent(deps, event.id)).toBe('event_ignored');
  });

  test('a missing payload blob is recorded as payload_missing', async () => {
    const event = await storeGithubEvent(deps, 'pull_request.opened', {
      fullName: repository.githubFullName,
    });
    await deps.blobStore.delete(event.blobKey);

    expect(await processGithubEvent(deps, event.id)).toBe('payload_missing');
  });
});

describe('PR snapshot sync (P sync.test.ts 33, 60, 70)', () => {
  test('an unchanged PR is left alone', async () => {
    await deliver('pull_request.opened-draft');
    const before = await rowVersion(312);

    await deliver('pull_request.opened-draft');

    expect(await rowVersion(312)).toBe(before);
  });

  test('GitHub dates refresh even when no commit arrived', async () => {
    await deliver('pull_request.opened-draft');

    await deliver('pull_request.opened-draft', {
      action: 'edited',
      pullRequest: { updated_at: '2026-11-18T10:30:00Z' },
    });

    const pr = await getPullRequest(deps.db, repository.id, 312);
    expect(pr?.updatedAt.toISOString()).toBe('2026-11-18T10:30:00.000Z');
    expect(pr?.headSha).toBe('2'.repeat(40));
  });

  test('an older delivery never replaces a newer snapshot', async () => {
    await deliver('pull_request.synchronize');

    await deliver('pull_request.opened-draft');

    const pr = await getPullRequest(deps.db, repository.id, 312);
    expect(pr?.headSha).toBe('3'.repeat(40));
    expect(pr?.isDraft).toBe(false);
  });

  test('a late delivery of a PR opened as a draft starts no round', async () => {
    expect(await deliver('pull_request.synchronize')).toBe('push_never_starts');

    expect(await deliver('pull_request.opened-draft')).toBe('draft');

    expect(await runsOf(312)).toHaveLength(0);
  });

  test('a late ready delivery starts no second round 1 after the round it caused', async () => {
    expect(await deliver('pull_request.ready_for_review')).toBe('round_started');
    const [round] = await runsOf(312);
    await deps.db
      .update(schema.runs)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(schema.runs.id, round!.id));

    expect(await deliver('pull_request.opened')).toBe('event_stale');

    expect(await runsOf(312)).toHaveLength(1);
  });

  test('a retried event starts no second round 1, even after its round ended', async () => {
    let fail = true;
    const throwingOnce = () => {
      if (!fail) return Promise.resolve();
      fail = false;
      return Promise.reject(new Error('hook failed'));
    };
    const withHook = {
      ...deps,
      extensions: {
        ...deps.extensions,
        prEventHooks: { ...deps.extensions.prEventHooks, ready: [throwingOnce] },
      },
    };
    const event = await storeGithubEvent(deps, 'pull_request.ready_for_review', {
      fullName: repository.githubFullName,
    });

    await expect(processGithubEvent(withHook, event.id)).rejects.toThrow('hook failed');
    const [round] = await runsOf(312);
    await deps.db
      .update(schema.runs)
      .set({ status: 'failed', finishedAt: new Date() })
      .where(eq(schema.runs.id, round!.id));

    expect(await processGithubEvent(withHook, event.id)).toBe('round_started');
    expect(await runsOf(312)).toHaveLength(1);
  });

  test('a ready delivery that arrives after a later push still starts round 1', async () => {
    expect(await deliver('pull_request.synchronize')).toBe('push_never_starts');

    expect(await deliver('pull_request.ready_for_review')).toBe('round_started');

    expect(await runsOf(312)).toHaveLength(1);
  });

  test('a closed PR leaves the open list and returns when reopened', async () => {
    await deliver('pull_request.opened-draft');

    expect(await deliver('pull_request.closed')).toBe('pr_closed');
    expect((await getPullRequest(deps.db, repository.id, 312))?.state).toBe('closed');

    await deliver('pull_request.reopened');
    expect((await getPullRequest(deps.db, repository.id, 312))?.state).toBe('open');
  });
});

async function rowVersion(prNumber: number): Promise<string> {
  const pr = await getPullRequest(deps.db, repository.id, prNumber);
  const result = await deps.db.execute<{ xmin: string }>(
    sql`select xmin::text from pull_requests where id = ${pr!.id}`,
  );
  return result.rows[0]!.xmin;
}
