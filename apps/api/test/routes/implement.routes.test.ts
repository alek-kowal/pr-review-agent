// S-13-T4: Implement with agent (signed, with the decisions or on its own) and the patch routes
// (unsigned, "by hand"): diffs, edit, revert, revise.
import { HAND } from '@pra/core';
import {
  closeDb,
  createDb,
  createQueue,
  eq,
  getPatch,
  insertRun,
  JOBS,
  schema,
  storePatchRevision,
  timelineOf,
  upsertRepository,
  type FindingRow,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, aRun, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import { LocalBlobStore } from '@pra/integrations';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PatchDetailSchema } from '../../src/pr-view/patch.ts';
import { DecideResponse } from '../../src/routes/api/decisions/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});
const blobStore = new LocalBlobStore(mkdtempSync(path.join(tmpdir(), 'pra-api-patches-')));

let app: FastifyInstance;
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
  app = await build({ db, queue, blobStore });
});

const versions = (findings: Pick<FindingRow, 'id' | 'version'>[]) =>
  Object.fromEntries(findings.map((f) => [f.id, f.version]));

async function reviewedPr(level: 3 | 4 = 4) {
  const pr = await seedPr(db, repository.id, { level });
  const { findings } = await seedRound(db, pr, { findings: blocking(2) });
  return { pr, findings };
}

const post = (url: string, payload: Record<string, unknown> = {}) =>
  app.inject({ method: 'POST', url, headers: SAME_ORIGIN, payload });

const decideWithAgent = (pr: PullRequest, findings: FindingRow[]) =>
  post(`/api/prs/${repository.slug}/${pr.number}/decisions`, {
    findingIds: findings.map((f) => f.id),
    decision: 'implement',
    signedBy: kasia.id,
    expectedVersions: versions(findings),
    withAgent: true,
  });

const runsOf = (pr: PullRequest) =>
  db.select().from(schema.runs).where(eq(schema.runs.pullRequestId, pr.id));

/** A ready patch (revision 1) with two files whose base and patched content are in BlobStore. */
async function readyPatch() {
  const { pr, findings } = await reviewedPr();
  const run = await insertRun(
    db,
    aRun(pr.id, { kind: 'implementer', status: 'completed', levelNumber: 4 }),
  );
  const contents = {
    'base/a': 'one\ntwo\nthree\n',
    'after/a': 'one\nTWO\nthree\n',
    'base/b': 'export const b = 1;\n',
    'after/b': 'export const b = 2;\n',
  };
  for (const [key, text] of Object.entries(contents)) {
    await blobStore.put(`${run.id}/${key}`, text, { contentType: 'text/plain' });
  }
  const { patch } = await storePatchRevision(db, {
    pullRequestId: pr.id,
    runId: run.id,
    baseSha: pr.headSha,
    findingIds: findings.map((f) => f.id),
    fixedFindingIds: findings.map((f) => f.id),
    reproductions: Object.fromEntries(findings.map((f) => [String(f.id), 'pass' as const])),
    summary: 'Fixed both',
    reviseNote: null,
    startedBy: HAND,
    files: [
      { path: 'src/a.ts', baseBlobKey: `${run.id}/base/a`, blobKey: `${run.id}/after/a` },
      { path: 'src/b.ts', baseBlobKey: `${run.id}/base/b`, blobKey: `${run.id}/after/b` },
    ],
  });
  return { pr, patch, run };
}

const patchChecks = (patchId: number) =>
  queue.findJobs(JOBS.patchCheck, { data: { patchId }, queued: true });

describe('Implement with agent', () => {
  test('decide-with-agent writes N decisions and one implementer run under one signer', async () => {
    const { pr, findings } = await reviewedPr();

    const response = await decideWithAgent(pr, findings);

    expect(response.statusCode).toBe(200);
    const body = DecideResponse.parse(response.json());
    expect(body.implementerRunId).toEqual(expect.any(Number));
    const runs = (await runsOf(pr)).filter((run) => run.kind === 'implementer');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: body.implementerRunId,
      status: 'queued',
      startedBy: 'member',
      startedByMemberId: kasia.id,
    });
    expect(body.findings.findings.map((f) => f.decision?.decision)).toEqual([
      'implement',
      'implement',
    ]);
    const decided = (await timelineOf(db, pr.id)).find((e) => e.kind === 'findings_decided');
    expect(decided).toMatchObject({ actor: 'member', memberId: kasia.id });
  });

  test('decisions that started the implementer cannot be undone while it runs', async () => {
    const { pr, findings } = await reviewedPr();
    const body = DecideResponse.parse((await decideWithAgent(pr, findings)).json());

    const undo = await post(`/api/decision-batches/${body.batchId}/undo`);

    expect(undo.statusCode).toBe(409);
    expect(undo.json()).toEqual({
      error: { code: 'run_active', params: { kind: 'implementer', status: 'queued' } },
    });
    const decisions = (await timelineOf(db, pr.id)).filter((e) => e.kind === 'decision_undone');
    expect(decisions).toEqual([]);
  });

  test('a level 3 PR returns 409 implement_below_level and keeps no decision', async () => {
    const { pr, findings } = await reviewedPr(3);

    const response = await decideWithAgent(pr, findings);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'implement_below_level', params: { level: 3, need: 4 } },
    });
    expect(await runsOf(pr)).toHaveLength(1);
    expect((await timelineOf(db, pr.id)).map((e) => e.kind)).not.toContain('findings_decided');
  });

  test('implement on decided findings starts the run; a second one is refused as run_active', async () => {
    const { pr, findings } = await reviewedPr();
    await post(`/api/prs/${repository.slug}/${pr.number}/decisions`, {
      findingIds: findings.map((f) => f.id),
      decision: 'implement',
      signedBy: kasia.id,
      expectedVersions: versions(findings),
    });
    const url = `/api/prs/${repository.slug}/${pr.number}/implement`;

    expect((await post(url, {})).json()).toMatchObject({ error: { code: 'signature_required' } });
    const started = await post(url, { signedBy: kasia.id });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ findingIds: findings.map((f) => f.id) });
    const again = await post(url, { signedBy: kasia.id });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'run_active' } });
  });

  test('the PR view carries the gate, the running implementer and the patch', async () => {
    const { pr, findings } = await reviewedPr(3);
    const view = await app.inject({ url: `/api/prs/${repository.slug}/${pr.number}` });
    expect(view.json().implementer).toMatchObject({
      block: { code: 'implement_below_level', params: { level: 3, need: 4 } },
      gate: { allowed: false },
      activeRun: null,
      patch: null,
    });
    expect(findings).toHaveLength(2);
  });
});

describe('patch routes', () => {
  test('GET returns one unified diff per file against the base', async () => {
    const { patch } = await readyPatch();

    const response = await app.inject({ url: `/api/patches/${patch.id}` });

    const detail = PatchDetailSchema.parse(response.json());
    expect(detail.patch).toMatchObject({ revision: 1, fixed: 2, total: 2, reproductions: 'pass' });
    expect(detail.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(detail.files[0]!.diff).toBe(
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n',
    );
  });

  test('an edit stores a new blob, resets the reproductions and queues a patch check', async () => {
    const { pr, patch, run } = await readyPatch();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/patches/${patch.id}/files`,
      headers: SAME_ORIGIN,
      payload: {
        path: 'src/a.ts',
        revision: 1,
        blobKey: `${run.id}/after/a`,
        content: 'one\nTwo\nthree\n',
      },
    });

    expect(response.statusCode).toBe(200);
    const detail = PatchDetailSchema.parse(response.json());
    const file = detail.files.find((f) => f.path === 'src/a.ts')!;
    expect(file).toMatchObject({ status: 'edited', content: 'one\nTwo\nthree\n' });
    expect(file.blobKey).not.toBe(`${run.id}/after/a`);
    expect(detail.patch).toMatchObject({ checking: true, reproductions: 'not_run' });
    expect(await patchChecks(patch.id)).toHaveLength(1);
    const entry = (await timelineOf(db, pr.id)).find((e) => e.kind === 'patch_file_edited');
    expect(entry).toMatchObject({ actor: 'hand', params: { revision: 1, path: 'src/a.ts' } });
  });

  test('edits on two patches queue a check for each, not one for the whole system', async () => {
    const one = await readyPatch();
    const two = await readyPatch();
    for (const { patch, run } of [one, two]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/patches/${patch.id}/files`,
        headers: SAME_ORIGIN,
        payload: { path: 'src/b.ts', revision: 1, blobKey: `${run.id}/after/b`, content: 'b\n' },
      });
      expect(response.statusCode).toBe(200);
    }

    expect(await patchChecks(one.patch.id)).toHaveLength(1);
    expect(await patchChecks(two.patch.id)).toHaveLength(1);
  });

  test('a stale edit returns 409 patch_stale', async () => {
    const { patch } = await readyPatch();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/patches/${patch.id}/files`,
      headers: SAME_ORIGIN,
      payload: { path: 'src/a.ts', revision: 1, blobKey: 'an-old-key', content: 'x\n' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'patch_stale', params: { revision: 1 } } });
  });

  test('an edit while a revise run of the patch is active returns 409 run_active', async () => {
    const { patch, run } = await readyPatch();
    const revised = await post(`/api/patches/${patch.id}/revise`, { note: 'Keep the old name.' });
    expect(revised.statusCode).toBe(202);

    const response = await app.inject({
      method: 'PUT',
      url: `/api/patches/${patch.id}/files`,
      headers: SAME_ORIGIN,
      payload: { path: 'src/a.ts', revision: 1, blobKey: `${run.id}/after/a`, content: 'x\n' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'run_active', params: { kind: 'implementer', status: 'queued' } },
    });
    expect((await getPatch(db, patch.id))!.files.find((f) => f.path === 'src/a.ts')).toMatchObject({
      status: 'changed',
      blobKey: `${run.id}/after/a`,
    });
  });

  test('a revert points the file at its base and is recorded by hand', async () => {
    const { pr, patch, run } = await readyPatch();

    const response = await post(`/api/patches/${patch.id}/files/revert`, {
      path: 'src/b.ts',
      revision: 1,
      blobKey: `${run.id}/after/b`,
    });

    const file = PatchDetailSchema.parse(response.json()).files.find((f) => f.path === 'src/b.ts');
    expect(file).toMatchObject({ status: 'reverted', diff: '' });
    const entry = (await timelineOf(db, pr.id)).find((e) => e.kind === 'patch_file_reverted');
    expect(entry).toMatchObject({ actor: 'hand' });
  });

  test('revise without a note returns 400; with a note it starts a revise run by hand', async () => {
    const { pr, patch } = await readyPatch();

    const empty = await post(`/api/patches/${patch.id}/revise`, { note: '  ' });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toEqual({ error: { code: 'note_required', params: {} } });

    const revised = await post(`/api/patches/${patch.id}/revise`, { note: 'Keep the old name.' });
    expect(revised.statusCode).toBe(202);
    const run = (await runsOf(pr)).find((r) => r.id === revised.json().runId);
    expect(run).toMatchObject({ kind: 'implementer', trigger: 'revise', startedBy: 'hand' });
    const entry = (await timelineOf(db, pr.id)).find((e) => e.kind === 'patch_revise_requested');
    expect(entry).toMatchObject({ actor: 'hand', params: { note: 'Keep the old name.' } });
  });

  test('revise on a patch built before the latest reviewed commit returns 409 patch_stale', async () => {
    const { pr, patch } = await readyPatch();
    // The author pushed and a round reviewed the new head: the patch's whole files would undo it.
    await seedRound(db, pr, { run: { roundNo: 2, headSha: 'c'.repeat(40) } });

    const revised = await post(`/api/patches/${patch.id}/revise`, { note: 'Keep the old name.' });

    expect(revised.statusCode).toBe(409);
    expect(revised.json()).toEqual({
      error: { code: 'patch_stale', params: { revision: patch.revision } },
    });
    expect((await runsOf(pr)).filter((r) => r.trigger === 'revise')).toEqual([]);
  });
});
