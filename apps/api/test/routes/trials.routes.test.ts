// S-22-T7: the Trials API. Each test has its own repository, PR and draft (api test files share
// a database).
import { compareFindings } from '@pra/core';
import {
  closeDb,
  createDb,
  createQueue,
  findingsOf,
  getRun,
  importInstructionV1,
  insertAgentSession,
  insertFindings,
  insertRun,
  insertStageExecution,
  saveInstructionDraft,
  upsertPullRequest,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aFinding, aPullRequest, aRun, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { TrialDetailResponse, TrialsListResponse } from '../../src/routes/api/trials/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
// Started (to send), but no worker subscribes in api tests.
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});
let app: FastifyInstance;
let repository: Repository;
let pullRequest: PullRequest;
let draftId: number;

beforeAll(async () => {
  await queue.start();
});

afterAll(async () => {
  await queue.stop({ graceful: false }).catch(() => {});
  await closeDb(db);
});

beforeEach(async () => {
  const id = uniqueId();
  repository = await upsertRepository(db, { slug: `wb-${id}`, githubFullName: `acme-${id}/wb` });
  ({ pullRequest } = await upsertPullRequest(db, aPullRequest(repository.id, { number: 272 })));
  const { version } = await importInstructionV1(db, {
    scope: 'repository',
    repositoryId: repository.id,
    fileKey: `rules-${id}.md`,
    content: 'one\ntwo\n',
  });
  const draft = await db.transaction((tx) =>
    saveInstructionDraft(tx, version.fileId, { content: 'one\nthree\n', note: null }),
  );
  draftId = draft!.id;
  app = await build({ db, queue });
});

const start = (patch: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/trials',
    headers: SAME_ORIGIN,
    payload: { pr: { repo: repository.slug, number: 272 }, instructionDraft: draftId, ...patch },
  });

/** A session of `costUsd` on a new execution of `stage` in the run. */
async function spend(runId: number, costUsd: number, stage = 'review') {
  const execution = await insertStageExecution(db, {
    runId,
    stage,
    attempt: 1,
    status: 'succeeded',
  });
  await insertAgentSession(db, {
    stageExecutionId: execution.id,
    role: 'reviewer',
    model: 'claude-sonnet-5-5',
    costUsd,
    costSource: 'reported',
    status: 'completed',
  });
}

describe('POST /api/trials', () => {
  test('starts two trial runs on the PR head, recorded "Started by hand"', async () => {
    const response = await start();

    expect(response.statusCode).toBe(201);
    const { trial } = TrialDetailResponse.parse(response.json());
    expect(trial).toMatchObject({
      pr: { repo: repository.slug, number: 272 },
      draft: { id: draftId, version: 2, status: 'draft' },
      status: 'running',
      startedBy: 'hand',
      headSha: pullRequest.headSha,
      // Run A has not started: the draft against the file's active version.
      diff: {
        before: { version: 1, content: 'one\ntwo\n' },
        after: { version: 2, content: 'one\nthree\n' },
      },
    });
    for (const side of [trial.runs.a!, trial.runs.b!]) {
      expect(await getRun(db, side.id)).toMatchObject({
        kind: 'trial',
        status: 'queued',
        startedBy: 'hand',
        startedByMemberId: null,
        headSha: pullRequest.headSha,
      });
    }

    const list = TrialsListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/trials' })).json(),
    );
    expect(list.trials.find((t) => t.id === trial.id)).toMatchObject({ startedBy: 'hand' });
  });

  test('a version that is not a draft gives 409, an unknown PR 404', async () => {
    const active = await start({ instructionDraft: draftId - 1 });
    expect(active.statusCode).toBe(409);
    expect(active.json().error).toEqual({
      code: 'trial_needs_draft',
      params: { versionId: draftId - 1, status: 'active' },
    });
    const missing = await start({ pr: { repo: repository.slug, number: 999 } });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('pr_not_found');
  });
});

describe('GET /api/trials/:id', () => {
  test('the compare buckets match the core rule; the costs come from the trial sessions only', async () => {
    const { trial: started } = TrialDetailResponse.parse((await start()).json());
    const runA = started.runs.a!.id;
    const runB = started.runs.b!.id;
    await insertFindings(db, [
      aFinding(runA, pullRequest.id, 1, { title: 'Null check missing', line: 10 }),
      aFinding(runA, pullRequest.id, 2, { title: 'Unused import', line: 3 }),
    ]);
    await insertFindings(db, [
      aFinding(runB, pullRequest.id, 1, { title: 'null check missing!', line: 11 }),
      aFinding(runB, pullRequest.id, 2, { title: 'Public API renamed', line: 40 }),
    ]);
    await spend(runA, 0.1);
    await spend(runB, 0.2);
    await spend(runB, 0.05, 'verify');
    // A round of the same PR: its cost is the PR's, not the trial's.
    const round = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));
    await spend(round.id, 5);

    const response = await app.inject({ method: 'GET', url: `/api/trials/${started.id}` });

    expect(response.statusCode).toBe(200);
    const { trial } = TrialDetailResponse.parse(response.json());
    const expected = compareFindings(await findingsOf(db, runA), await findingsOf(db, runB));
    expect(trial.compare.both.map((p) => [p.a.id, p.b.id])).toEqual(
      expected.both.map((p) => [p.a.id, p.b.id]),
    );
    expect(trial.compare.onlyA.map((f) => f.title)).toEqual(['Unused import']);
    expect(trial.compare.onlyB.map((f) => f.title)).toEqual(['Public API renamed']);
    expect(trial.runs.a!.costUsd).toBeCloseTo(0.1);
    expect(trial.runs.b!.costUsd).toBeCloseTo(0.25);
  });

  test('a missing trial answers 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/trials/999999999' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('trial_not_found');
  });
});
