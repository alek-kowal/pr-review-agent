// S-14-T3: `POST /api/patches/:id/push { typedNumber, signedBy }` checks the push rule against
// fresh GitHub state and queues exactly one push job.
import { HAND } from '@pra/core';
import {
  closeDb,
  createDb,
  createQueue,
  insertRun,
  JOBS,
  storePatchRevision,
  upsertRepository,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, aRun, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import { FakeGitHubGateway, fixturePullRequest } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PushResponse } from '../../src/routes/api/patches/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});

let app: FastifyInstance;
let github: FakeGitHubGateway;
let repository: Repository;
let kasia: { id: string; name: string };
beforeAll(async () => {
  await queue.start();
  repository = await upsertRepository(db, aRepositoryConfig());
  kasia = await seedTeamMember(db, { name: 'Kasia' });
});
afterAll(async () => {
  await queue.stop({ graceful: false }).catch(() => {});
  await closeDb(db);
});
beforeEach(async () => {
  github = new FakeGitHubGateway();
  app = await build({ db, queue, github });
});

/** A reviewed PR with a ready patch made on its head, and GitHub agreeing on the head. */
async function readyPatch() {
  const pr = await seedPr(db, repository.id, { level: 4 });
  const { findings } = await seedRound(db, pr, { findings: blocking(2) });
  const run = await insertRun(
    db,
    aRun(pr.id, { kind: 'implementer', status: 'completed', levelNumber: 4 }),
  );
  const { patch } = await storePatchRevision(db, {
    pullRequestId: pr.id,
    runId: run.id,
    baseSha: pr.headSha,
    findingIds: findings.map((f) => f.id),
    fixedFindingIds: findings.map((f) => f.id),
    reproductions: {},
    summary: 'Fixed both',
    reviseNote: null,
    startedBy: HAND,
    files: [{ path: 'src/a.ts', baseBlobKey: null, blobKey: `${run.id}/after/a` }],
  });
  github.addPullRequest({
    ...fixturePullRequest('pull_request.ready_for_review'),
    fullName: repository.githubFullName,
    number: pr.number,
    headSha: pr.headSha,
  });
  return { pr, patch };
}

const push = (patchId: number, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/patches/${patchId}/push`,
    headers: SAME_ORIGIN,
    payload,
  });

const pushJobs = (patchId: number) =>
  queue.findJobs(JOBS.patchPush, { data: { patchId }, queued: true });

describe('push endpoint', () => {
  test('a wrong number returns 409 pr_number_mismatch and queues nothing', async () => {
    const { pr, patch } = await readyPatch();

    const response = await push(patch.id, { typedNumber: pr.number + 1, signedBy: kasia.id });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'pr_number_mismatch', params: { number: pr.number } },
    });
    expect(await pushJobs(patch.id)).toHaveLength(0);
  });

  test('a moved head returns 409 head_moved with the new SHA', async () => {
    const { pr, patch } = await readyPatch();
    const moved = 'd'.repeat(40);
    github.addPullRequest({
      ...github.pullRequests.get(`${repository.githubFullName}#${pr.number}`)!,
      headSha: moved,
    });

    const response = await push(patch.id, { typedNumber: pr.number, signedBy: kasia.id });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'head_moved', params: { headSha: moved } } });
    expect(await pushJobs(patch.id)).toHaveLength(0);
  });

  test('success returns 202 and queues exactly one push job, even when sent twice', async () => {
    const { pr, patch } = await readyPatch();

    const first = await push(patch.id, { typedNumber: pr.number, signedBy: kasia.id });
    const second = await push(patch.id, { typedNumber: String(pr.number), signedBy: kasia.id });

    expect(first.statusCode).toBe(202);
    expect(PushResponse.parse(first.json())).toEqual({ queued: true });
    expect(second.statusCode).toBe(202);
    const jobs = await pushJobs(patch.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toEqual({ patchId: patch.id, signedBy: kasia.id });
  });

  test('a missing signer returns 400 signature_required; an unknown one signer_unknown', async () => {
    const { pr, patch } = await readyPatch();

    const missing = await push(patch.id, { typedNumber: pr.number });
    const unknown = await push(patch.id, {
      typedNumber: pr.number,
      signedBy: '00000000-0000-4000-8000-000000000000',
    });

    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: 'signature_required' } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json()).toMatchObject({ error: { code: 'signer_unknown' } });
    expect(await pushJobs(patch.id)).toHaveLength(0);
  });

  test('an unknown patch returns 404 patch_not_found', async () => {
    const response = await push(999_999, { typedNumber: 1, signedBy: kasia.id });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'patch_not_found' } });
  });
});
