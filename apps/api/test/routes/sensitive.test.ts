// S-11-T2: approve sensitive files by hand, send them back signed, and the PR summary's files.
import {
  addSensitiveFiles,
  and,
  closeDb,
  createDb,
  eq,
  schema,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SensitiveResult } from '../../src/routes/api/sensitive/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
let app: FastifyInstance;
let repository: Repository;

beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
});
afterAll(() => closeDb(db));
beforeEach(async () => {
  app = await build({ db });
});

const FILES = [
  { path: 'db/migrations/0001_edge_labels.sql', pattern: 'db/migrations/**', reason: 'Runs once.' },
  { path: 'infra/main.tf', pattern: 'infra/**', reason: 'Changes production.' },
];

const url = (pr: PullRequest, path = '') => `/api/prs/${repository.slug}/${pr.number}${path}`;

/** A reviewed PR with no finding left to decide and 2 pending sensitive files (version 1). */
async function prWithSensitiveFiles(): Promise<PullRequest> {
  const pr = await seedPr(db, repository.id);
  await seedRound(db, pr);
  await addSensitiveFiles(db, pr.id, FILES, pr.headSha);
  return pr;
}

const post = (pr: PullRequest, action: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: url(pr, `/sensitive/${action}`),
    headers: SAME_ORIGIN,
    payload,
  });

async function view(pr: PullRequest) {
  const response = await app.inject({ method: 'GET', url: url(pr) });
  expect(response.statusCode).toBe(200);
  return response.json();
}

const timeline = (pr: PullRequest, kind: string) =>
  db
    .select()
    .from(schema.timelineEntries)
    .where(
      and(eq(schema.timelineEntries.pullRequestId, pr.id), eq(schema.timelineEntries.kind, kind)),
    );

describe('sensitive files', () => {
  test('the PR summary lists the files, their status and the checklist row', async () => {
    const pr = await prWithSensitiveFiles();
    const body = await view(pr);
    expect(body.sensitive).toEqual({
      version: 1,
      status: 'pending',
      files: FILES.map((file) => ({ ...file, status: 'pending' })),
      sentBack: null,
    });
    expect(body.nextStep.banner).toEqual({ code: 'state_sensitive_files', params: { count: 2 } });
    expect(body.nextStep.mainAction).toMatchObject({ action: 'approve_sensitive', signed: false });
    expect(
      body.checklist.items.find((i: { item: string }) => i.item === 'sensitive_files_approved'),
    ).toEqual({
      item: 'sensitive_files_approved',
      ok: false,
      reason: { code: 'checklist_sensitive_pending', params: { count: 2 } },
    });
  });

  test('a PR without sensitive files has an empty section and no checklist row', async () => {
    const pr = await seedPr(db, repository.id);
    await seedRound(db, pr);
    const body = await view(pr);
    expect(body.sensitive).toEqual({ version: 0, status: null, files: [], sentBack: null });
    expect(body.checklist.items.map((i: { item: string }) => i.item)).not.toContain(
      'sensitive_files_approved',
    );
  });

  test('approve without a signer works and records hand', async () => {
    const pr = await prWithSensitiveFiles();
    const response = await post(pr, 'approve', { version: 1 });
    expect(response.statusCode).toBe(200);
    const body = SensitiveResult.parse(response.json());
    expect(body.sensitive).toMatchObject({ version: 2, status: 'approved', sentBack: null });
    expect(body.sensitive.files.map((f) => f.status)).toEqual(['approved', 'approved']);
    expect(body.checklist.items.find((i) => i.item === 'sensitive_files_approved')).toEqual({
      item: 'sensitive_files_approved',
      ok: true,
      reason: { code: 'checklist_sensitive_approved', params: { count: 2 } },
    });
    expect(body.nextStep.state).toBe('ready_to_merge');

    const [entry] = await timeline(pr, 'sensitive_approved');
    expect(entry).toMatchObject({
      actor: 'hand',
      memberId: null,
      params: { count: 2, files: FILES.map((f) => f.path) },
    });
    const rows = await db
      .select()
      .from(schema.sensitiveFiles)
      .where(eq(schema.sensitiveFiles.pullRequestId, pr.id));
    expect(rows.every((row) => row.actor === 'hand' && row.status === 'approved')).toBe(true);

    // Nothing is left to approve.
    expect((await post(pr, 'approve', { version: 2 })).json()).toEqual({
      error: { code: 'sensitive_nothing_pending', params: {} },
    });
  });

  test('send back is signed and carries a comment', async () => {
    const pr = await prWithSensitiveFiles();
    const tomek = await seedTeamMember(db, { name: 'Tomek' });
    const response = await post(pr, 'send-back', {
      version: 1,
      comment: 'Split the migration out.',
      signedBy: tomek.id,
    });
    expect(response.statusCode).toBe(200);
    const body = SensitiveResult.parse(response.json());
    expect(body.sensitive).toMatchObject({
      version: 2,
      status: 'sent_back',
      sentBack: { by: { id: tomek.id, name: 'Tomek' }, comment: 'Split the migration out.' },
    });
    expect(body.nextStep.banner).toEqual({
      code: 'state_sensitive_sent_back',
      params: { count: 2, by: { kind: 'member', memberId: tomek.id } },
    });
    const [entry] = await timeline(pr, 'sensitive_sent_back');
    expect(entry).toMatchObject({
      actor: 'member',
      memberId: tomek.id,
      params: { count: 2, comment: 'Split the migration out.' },
    });
  });

  test('send back without a comment or a signer returns 400', async () => {
    const pr = await prWithSensitiveFiles();
    const tomek = await seedTeamMember(db);
    const noSigner = await post(pr, 'send-back', { version: 1, comment: 'Why.' });
    expect(noSigner.statusCode).toBe(400);
    expect(noSigner.json().error.code).toBe('signature_required');
    const noComment = await post(pr, 'send-back', {
      version: 1,
      comment: '  ',
      signedBy: tomek.id,
    });
    expect(noComment.statusCode).toBe(400);
    expect(noComment.json().error.code).toBe('comment_required');
    const unknown = await post(pr, 'send-back', {
      version: 1,
      comment: 'Why.',
      signedBy: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('signer_unknown');
    expect((await view(pr)).sensitive.status).toBe('pending');
  });

  test('a stale version returns 409 and changes nothing', async () => {
    const pr = await prWithSensitiveFiles();
    // A new file arrived after the person loaded the page.
    await addSensitiveFiles(
      db,
      pr.id,
      [{ path: 'db/migrations/0002_more.sql', pattern: 'db/migrations/**', reason: 'Runs once.' }],
      pr.headSha,
    );
    const response = await post(pr, 'approve', { version: 1 });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'sensitive_stale', params: { version: 2 } } });
    expect((await view(pr)).sensitive).toMatchObject({ version: 2, status: 'pending' });
  });

  test('an unknown PR returns 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/prs/${repository.slug}/99999/sensitive/approve`,
      headers: SAME_ORIGIN,
      payload: { version: 0 },
    });
    expect(response.statusCode).toBe(404);
  });
});
