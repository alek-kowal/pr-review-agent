// S-23-T3: the analyst job. Closing a level 6 PR starts one analysis by the bot; the Analyse stage
// gives the analyst the PR without its author's comments, and the run's end records the candidates
// (merged into the repository's) and the analysis status.
import type { AnalystCandidate } from '@pra/agents';
import {
  eq,
  findPullRequest,
  getRun,
  importInstructionV1,
  latestAnalysisOf,
  listLessonCandidates,
  schema,
  startAnalysis,
  upsertPullRequest,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { fixturePullRequest } from '@pra/integrations/testing';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let deps: TestWorkerDeps;
const closedFixture = fixturePullRequest('pull_request.closed');

const candidate = (title: string, lesson = `${title}.`): AnalystCandidate => ({
  title,
  lesson,
  evidence: 'Asked twice in review.',
  duplicateOf: null,
});

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({ url: database.url });
  await importInstructionV1(deps.db, {
    scope: 'global',
    fileKey: 'prompt-analyst.md',
    content: 'Propose lessons from this PR.',
  });
  await importInstructionV1(deps.db, {
    scope: 'global',
    fileKey: 'analyst-rules.md',
    content: 'At most 5 candidates.',
  });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await database?.drop();
});

async function repositoryAt(level: 5 | 6): Promise<Repository> {
  const repository = await connectRepository(deps.db, { defaultLevel: level });
  deps.github.installations.set(repository.githubFullName, 1);
  return repository;
}

/** Delivers `pull_request.closed` for the fixture PR of `repository` and returns the stored PR. */
async function closeOn(repository: Repository): Promise<PullRequest> {
  const event = await storeGithubEvent(deps, 'pull_request.closed', {
    fullName: repository.githubFullName,
  });
  await processGithubEvent(deps, event.id);
  const found = await findPullRequest(deps.db, repository.slug, closedFixture.number);
  if (!found) throw new Error('closed PR not stored');
  return found.pullRequest;
}

const analysesOf = (pullRequestId: number) =>
  deps.db.select().from(schema.analyses).where(eq(schema.analyses.pullRequestId, pullRequestId));

async function mergedPr(repository: Repository, number: number): Promise<PullRequest> {
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { number, state: 'merged' }),
  );
  return pullRequest;
}

/** Starts an analysis by hand and runs its one stage with the analyst's next scripted answer. */
async function analyse(pullRequest: PullRequest, candidates: AnalystCandidate[]) {
  const started = await startAnalysis(deps, { pullRequestId: pullRequest.id, startedBy: 'hand' });
  if (!started.started) throw new Error(`analysis not started: ${started.reason}`);
  deps.analyst.enqueue({ candidates, summary: 'Read.' });
  await executeStage(deps, started.run.id, 'analyse');
  return started;
}

test('closing a level 6 PR queues one analysis by the bot', async () => {
  const repository = await repositoryAt(6);
  const pullRequest = await closeOn(repository);

  const [analysis, ...more] = await analysesOf(pullRequest.id);
  expect(more).toEqual([]);
  expect(analysis).toMatchObject({ startedBy: 'bot', status: 'running' });
  const run = await getRun(deps.db, analysis!.runId!);
  expect(run).toMatchObject({ kind: 'analyst', status: 'queued', pullRequestId: pullRequest.id });

  // The bot analyses a PR once: a second close (or merge) starts nothing.
  const again = await startAnalysis(deps, { pullRequestId: pullRequest.id, startedBy: 'bot' });
  expect(again.started).toBe(false);
  expect(await analysesOf(pullRequest.id)).toHaveLength(1);
});

test('closing a level 5 PR queues none', async () => {
  const repository = await repositoryAt(5);
  const pullRequest = await closeOn(repository);
  expect(await analysesOf(pullRequest.id)).toEqual([]);
});

test("the analyst's input has no comment by the PR author, and the finish is recorded", async () => {
  const repository = await repositoryAt(6);
  const pullRequest = await closeOn(repository);
  const author = pullRequest.authorLogin;
  deps.github
    .addComment(repository.githubFullName, pullRequest.number, author, 'I wrote this myself.')
    .addComment(repository.githubFullName, pullRequest.number, 'reviewer-ola', 'Snapshot tables?', {
      path: 'src/table.ts',
      line: 12,
    });
  const [analysis] = await analysesOf(pullRequest.id);
  deps.analyst.enqueue({ candidates: [candidate('Snapshot tables in tests')], summary: 'One.' });

  await executeStage(deps, analysis!.runId!, 'analyse');

  const input = deps.analyst.calls.at(-1)!;
  expect(input.comments.map((c) => c.author)).toEqual(['reviewer-ola']);
  expect(JSON.stringify(input)).not.toContain('I wrote this myself.');
  expect(input.pr).toMatchObject({ number: pullRequest.number, state: 'closed' });
  expect(await getRun(deps.db, analysis!.runId!)).toMatchObject({ status: 'completed' });
  expect(await latestAnalysisOf(deps.db, pullRequest.id)).toMatchObject({
    id: analysis!.id,
    status: 'finished',
    candidateCount: 1,
  });
});

test("a duplicate raises an existing candidate's PR count", async () => {
  const repository = await repositoryAt(6);
  const first = await mergedPr(repository, 501);
  const second = await mergedPr(repository, 502);

  await analyse(first, [candidate('Snapshot tables in tests')]);
  await analyse(second, [candidate('snapshot tables in tests', 'Same lesson, other words.')]);

  const candidates = (await listLessonCandidates(deps.db)).filter(
    (c) => c.repositoryId === repository.id,
  );
  expect(candidates).toHaveLength(1);
  expect(candidates[0]).toMatchObject({ prCount: 2, status: 'proposed' });
  expect(candidates[0]!.sources.map((s) => s.pullRequestId).sort()).toEqual(
    [first.id, second.id].sort(),
  );
});

test('a failed analyst ends the analysis "failed"', async () => {
  const repository = await repositoryAt(6);
  const pullRequest = await mergedPr(repository, 601);
  const started = await startAnalysis(deps, { pullRequestId: pullRequest.id, startedBy: 'hand' });
  if (!started.started) throw new Error('analysis not started');
  expect(await latestAnalysisOf(deps.db, pullRequest.id)).toMatchObject({ status: 'running' });

  deps.analyst.enqueue({ fail: 'output_invalid' });
  await executeStage(deps, started.run.id, 'analyse');

  expect(await getRun(deps.db, started.run.id)).toMatchObject({ status: 'failed' });
  expect(await latestAnalysisOf(deps.db, pullRequest.id)).toMatchObject({
    status: 'failed',
    candidateCount: null,
  });
});
