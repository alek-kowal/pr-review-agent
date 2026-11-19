// S-03-T5: a ready event and a completed round leave timeline entries and PR state changes.
// Own database, and the handlers called directly: no worker takes the jobs.
import {
  eq,
  getRun,
  importInstructionV1,
  schema,
  stateChangesOf,
  timelineOf,
  type Repository,
  type Run,
} from '@pra/db';
import { createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { postAfterRoundComment } from '../src/handlers/github-comment.ts';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { timelineOnRunCompleted } from '../src/run/timeline-hooks.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
  repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
  await importInstructionV1(deps.db, {
    scope: 'repository',
    repositoryId: repository.id,
    fileKey: 'review-rules.md',
    content: '# Rules\n\n{{diff}}',
  });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await Promise.all([database?.drop(), fixture?.remove()]);
});

const ANSWER = {
  summary: 'Adds inline renaming.',
  risk: 'low',
  findings: [],
  questions: [],
  notChecked: [],
};

async function readyRound(): Promise<{ run: Run; eventId: number }> {
  const event = await storeGithubEvent(deps, 'pull_request.ready_for_review', {
    fullName: repository.githubFullName,
    headSha: fixture.headSha,
  });
  expect(await processGithubEvent(deps, event.id)).toBe('round_started');
  const [run] = await deps.db.select().from(schema.runs);
  // The fixture repository's base, so the review stage can build its diff.
  await deps.db
    .update(schema.pullRequests)
    .set({ baseSha: fixture.baseSha })
    .where(eq(schema.pullRequests.id, run!.pullRequestId));
  return { run: run!, eventId: event.id };
}

test('a ready event and a completed round leave entries and state changes in order', async () => {
  const { run: queued, eventId } = await readyRound();
  deps.agentRunner.enqueue({ output: ANSWER, costUsd: 0.42 });

  expect(await executeStage(deps, queued.id, 'review')).toBe('succeeded');
  expect(await postAfterRoundComment(deps, queued.id)).toBe('posted');

  const run = (await getRun(deps.db, queued.id))!;
  const entries = await timelineOf(deps.db, run.pullRequestId);
  expect(
    entries.map(({ kind, actor, params, costUsd, runId }) => ({
      kind,
      actor,
      params,
      costUsd,
      runId,
    })),
  ).toEqual([
    // "PR marked ready for review"
    {
      kind: 'pr_ready',
      actor: 'hand',
      params: { via: 'github', action: 'ready_for_review' },
      costUsd: null,
      runId: null,
    },
    // "Round 1 of 3 started" (bot)
    {
      kind: 'run_started',
      actor: 'bot',
      params: { runKind: 'round', roundNumber: 1, trigger: 'ready_for_review' },
      costUsd: null,
      runId: run.id,
    },
    // "Round 1 finished" with its cost
    {
      kind: 'run_finished',
      actor: 'bot',
      params: { runKind: 'round', roundNumber: 1 },
      costUsd: 0.42,
      runId: run.id,
    },
    // GitHub comment posted: "Ready for team member review (round 1)" (bot)
    {
      kind: 'github_comment_posted',
      actor: 'bot',
      params: { body: 'Ready for team member review (round 1)' },
      costUsd: null,
      runId: run.id,
    },
  ]);
  const [event] = await deps.db
    .select()
    .from(schema.githubEvents)
    .where(eq(schema.githubEvents.id, eventId));
  expect(entries[0]!.at).toEqual(event!.receivedAt);
  expect(entries[1]!.at).toEqual(run.startedAt);
  expect(entries[2]!.at).toEqual(run.finishedAt);

  const states = await stateChangesOf(deps.db, run.pullRequestId);
  expect(states.map(({ state, lane, reason }) => ({ state, lane, code: reason.code }))).toEqual([
    { state: 'queued', lane: 'agents_working', code: 'pr_ready' },
    { state: 'round_running', lane: 'agents_working', code: 'run_started' },
    { state: 'ready_to_merge', lane: 'ready_to_merge', code: 'run_finished' },
  ]);
  expect(states.every((s) => s.headSha === fixture.headSha)).toBe(true);

  // Run detail shows the instruction files the run read.
  expect(run.instructionVersions).toEqual([
    { id: expect.any(Number), scope: 'repository', fileKey: 'review-rules.md', version: 1 },
  ]);
});

test('a retried hook or event writes nothing twice', async () => {
  const [run] = await deps.db.select().from(schema.runs);
  const [pullRequest] = await deps.db
    .select()
    .from(schema.pullRequests)
    .where(eq(schema.pullRequests.id, run!.pullRequestId));
  const before = await timelineOf(deps.db, run!.pullRequestId);

  await timelineOnRunCompleted({ deps, run: run!, repository, pullRequest: pullRequest! });

  expect(await timelineOf(deps.db, run!.pullRequestId)).toHaveLength(before.length);
  expect(await stateChangesOf(deps.db, run!.pullRequestId)).toHaveLength(3);
});
