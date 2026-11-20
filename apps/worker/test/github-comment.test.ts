// S-01-T11: the after-round GitHub comment, with `FakeGitHubGateway`. Handlers run directly on
// the shared test database.
import { DEFAULT_APP_SETTINGS } from '@pra/core';
import {
  eq,
  insertFindings,
  insertRun,
  JOBS,
  schema,
  upsertPullRequest,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aRun } from '@pra/db/testing';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { enqueueAfterRoundComment, postAfterRoundComment } from '../src/handlers/github-comment.ts';
import { connectRepository, createTestWorkerDeps, jobsWhere } from './support.ts';

const deps = await createTestWorkerDeps();
let repository: Repository;
let pullRequest: PullRequest;

beforeEach(async () => {
  repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 55500001);
  ({ pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id)));
});

afterEach(() => setCommentSetting(true));
afterAll(() => deps.close());

async function setCommentSetting(on: boolean): Promise<void> {
  const settings = { ...DEFAULT_APP_SETTINGS, afterRoundGithubComment: on };
  await deps.db
    .insert(schema.appSettings)
    .values({ id: 1, settings })
    .onConflictDoUpdate({ target: schema.appSettings.id, set: { settings } });
}

const aRound = (patch: Partial<Run> = {}) =>
  insertRun(
    deps.db,
    aRun(pullRequest.id, { status: 'completed', finishedAt: new Date(), ...patch }),
  );

const commentsOn = (pr: PullRequest) =>
  deps.github.comments.filter(
    (c) => c.fullName === repository.githubFullName && c.number === pr.number,
  );

const actionsOf = (runId: number) =>
  deps.db.select().from(schema.githubActions).where(eq(schema.githubActions.runId, runId));

const hookContext = (run: Run) => ({ deps, run, pullRequest, repository });

describe('after-round comment', () => {
  test('a completed round 1 posts exactly the sentence and records it', async () => {
    const run = await aRound();

    expect(await postAfterRoundComment(deps, run.id)).toBe('posted');

    const comments = commentsOn(pullRequest);
    expect(comments.map((c) => c.body)).toEqual(['Ready for team member review (round 1)']);
    expect(await actionsOf(run.id)).toEqual([
      expect.objectContaining({
        pullRequestId: pullRequest.id,
        kind: 'comment',
        body: 'Ready for team member review (round 1)',
        result: 'posted',
        githubId: comments[0]!.id,
      }),
    ]);
  });

  test('the round number is the run’s', async () => {
    const run = await aRound({ roundNo: 2 });
    await postAfterRoundComment(deps, run.id);
    expect(commentsOn(pullRequest).map((c) => c.body)).toEqual([
      'Ready for team member review (round 2)',
    ]);
  });

  test('a completed round queues one github.comment job keyed by the run', async () => {
    const run = await aRound();

    await enqueueAfterRoundComment(hookContext(run));

    expect(await jobsWhere(deps.db, JOBS.githubComment, 'runId', run.id)).toEqual([
      expect.objectContaining({ data: { runId: run.id }, singletonKey: `${run.id}` }),
    ]);
  });

  test('a failed or cancelled run posts nothing', async () => {
    for (const status of ['failed', 'cancelled'] as const) {
      const run = await aRound({ status });

      await enqueueAfterRoundComment(hookContext(run));
      expect(await jobsWhere(deps.db, JOBS.githubComment, 'runId', run.id)).toEqual([]);
      expect(await postAfterRoundComment(deps, run.id)).toBe('not_a_completed_round');
      expect(await actionsOf(run.id)).toEqual([]);
    }
    expect(commentsOn(pullRequest)).toEqual([]);
  });

  test('without the GitHub App nothing is queued or posted, and nothing is retried', async () => {
    const run = await aRound();
    deps.github.setMode('token');
    try {
      await enqueueAfterRoundComment(hookContext(run));
      expect(await jobsWhere(deps.db, JOBS.githubComment, 'runId', run.id)).toEqual([]);
      // A job queued before the switch resolves (no retry) and claims nothing.
      expect(await postAfterRoundComment(deps, run.id)).toBe('github_read_only');
      expect(await actionsOf(run.id)).toEqual([]);
    } finally {
      deps.github.setMode('app');
    }
  });

  test('nothing is posted when the setting is off', async () => {
    await setCommentSetting(false);
    const run = await aRound();

    await enqueueAfterRoundComment(hookContext(run));
    expect(await jobsWhere(deps.db, JOBS.githubComment, 'runId', run.id)).toEqual([]);
    expect(await postAfterRoundComment(deps, run.id)).toBe('comment_off');
    expect(commentsOn(pullRequest)).toEqual([]);
  });

  test('the job running twice posts one comment', async () => {
    const run = await aRound();

    const outcomes = await Promise.all([
      postAfterRoundComment(deps, run.id),
      postAfterRoundComment(deps, run.id),
    ]);
    expect(await postAfterRoundComment(deps, run.id)).toBe('already_posted');

    expect(outcomes.sort()).toEqual(['already_posted', 'posted']);
    expect(commentsOn(pullRequest)).toHaveLength(1);
    expect(await actionsOf(run.id)).toHaveLength(1);
  });

  test('a failed post is recorded and the retry posts once', async () => {
    const run = await aRound();
    deps.github.failNext('postIssueComment', new Error('GitHub is down'));

    await expect(postAfterRoundComment(deps, run.id)).rejects.toThrow('GitHub is down');
    expect(await actionsOf(run.id)).toEqual([expect.objectContaining({ result: 'failed' })]);

    expect(await postAfterRoundComment(deps, run.id)).toBe('posted');
    expect(await actionsOf(run.id)).toEqual([expect.objectContaining({ result: 'posted' })]);
    expect(commentsOn(pullRequest)).toHaveLength(1);
  });

  test('a posted comment is never repeated when recording it fails', async () => {
    const run = await aRound();
    // The post goes out, then the next database write fails once (a dropped connection). The
    // `posted` update and its timeline entry share one transaction.
    let failNextUpdate = false;
    const db = new Proxy(deps.db, {
      get(target, key, receiver) {
        if ((key === 'update' || key === 'transaction') && failNextUpdate) {
          failNextUpdate = false;
          throw new Error('connection reset');
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const github = {
      mode: 'app',
      postIssueComment: async (fullName: string, number: number, body: string) => {
        const posted = await deps.github.postIssueComment(fullName, number, body);
        failNextUpdate = true;
        return posted;
      },
    } as unknown as typeof deps.github;

    await expect(postAfterRoundComment({ ...deps, db, github }, run.id)).rejects.toThrow(
      'connection reset',
    );
    expect(await postAfterRoundComment(deps, run.id)).toBe('already_posted');

    expect(commentsOn(pullRequest)).toHaveLength(1);
    expect(await actionsOf(run.id)).toEqual([expect.objectContaining({ result: 'sending' })]);
  });

  test('the body has no URL and no finding text', async () => {
    const run = await aRound();
    await insertFindings(deps.db, [
      aFinding(run.id, pullRequest.id, 1, {
        title: 'Secret token logged in edges.ts',
        scenario: 'See https://example.invalid/leak',
      }),
    ]);

    await postAfterRoundComment(deps, run.id);

    const [comment] = commentsOn(pullRequest);
    expect(comment!.body).not.toMatch(/https?:|www\.|\/\//);
    expect(comment!.body).not.toContain('Secret token');
    expect(comment!.body).not.toContain('edges.ts');
  });
});
