// STAGEFILES: the signed stage-files setting and the pipeline's stage files by scope. Its own
// database, since it writes global choices and global files.
import {
  closeDb,
  createDb,
  importInstructionV1,
  listSettingsChanges,
  upsertRepository,
  type Db,
  type Repository,
} from '@pra/db';
import { createTestDatabase, seedTeamMember, type TestDatabase } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { PipelineResponse } from '../../src/routes/api/pipeline/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

let database: TestDatabase;
let db: Db;
let app: FastifyInstance;
let signer: { id: string };
let wb: Repository;
let other: Repository;

beforeAll(async () => {
  database = await createTestDatabase();
  db = createDb(database.url, { max: 2 });
  signer = await seedTeamMember(db, { name: 'Ola' });
  wb = await upsertRepository(db, { slug: 'wb', githubFullName: 'acme/wb' });
  other = await upsertRepository(db, { slug: 'other', githubFullName: 'acme/other' });
  const global = ['prompt-verifier.md', 'verify-rules.md', 'review-rules.md', 'lessons.md'];
  for (const fileKey of global) {
    await importInstructionV1(db, { scope: 'global', fileKey, content: `global ${fileKey}` });
  }
  // The deployed case: the import put these at repository scope only.
  const own = [
    'prompt-verifier.md',
    'verify-b-rules.md',
    'feature-map/sdk.md',
    'prompt-analyst.md',
  ];
  for (const fileKey of own) {
    await importInstructionV1(db, {
      scope: 'repository',
      repositoryId: wb.id,
      fileKey,
      content: `wb ${fileKey}`,
    });
  }
}, 30_000);

beforeEach(async () => {
  app = await build({ db });
});

afterAll(async () => {
  if (db) await closeDb(db);
  await database?.drop();
});

const put = (stage: string, payload: object) =>
  app.inject({
    method: 'PUT',
    url: `/api/settings/stage-files/${stage}`,
    headers: SAME_ORIGIN,
    payload,
  });

async function pipeline(repository?: string) {
  const url = repository ? `/api/pipeline?repository=${repository}` : '/api/pipeline';
  const response = await app.inject({ method: 'GET', url });
  expect(response.statusCode).toBe(200);
  return PipelineResponse.parse(response.json());
}

const stageOf = async (key: string, repository?: string) =>
  (await pipeline(repository)).stages.find((s) => s.key === key)!.files!;

const changes = (entity: string) => listSettingsChanges(db, { area: 'stage_files', entity });

describe('GET /api/pipeline by scope', () => {
  test("a repository's scope resolves its copies; Global names where a key only has copies", async () => {
    const atWb = await pipeline('wb');
    expect(atWb.scope.repository).toEqual({ id: wb.id, slug: 'wb' });
    expect(atWb.repositories.map((r) => r.slug)).toEqual(['other', 'wb']);
    const verify = atWb.stages.find((s) => s.key === 'verify')!.files!;
    expect(verify.slots[0]).toMatchObject({
      name: 'prompt',
      source: 'default',
      value: ['prompt-verifier.md'],
      files: [{ fileKey: 'prompt-verifier.md', scope: 'repository', version: 1 }],
    });
    expect(atWb.options.instruction.map((o) => o.fileKey)).toContain('verify-b-rules.md');
    expect(atWb.options.document.map((o) => o.fileKey)).toEqual([
      'feature-map/sdk.md',
      'lessons.md',
    ]);

    const global = await pipeline();
    expect(global.options.instruction.map((o) => o.fileKey)).not.toContain('verify-b-rules.md');
    // The reviewer's documents at Global scope: every global Markdown document.
    const review = global.stages.find((s) => s.key === 'review')!.files!;
    expect(review.slots.find((s) => s.name === 'documents')!.value).toEqual(['lessons.md']);
    expect(global.stages.find((s) => s.key === 'checks')!.files).toBeNull();
    // No global analyst prompt: the sheet can say which repositories hold a copy.
    const analyst = global.stages.find((s) => s.key === 'analyst')!.files!;
    expect(analyst.slots[0]!.files).toEqual([
      {
        fileKey: 'prompt-analyst.md',
        kind: 'instruction',
        fileId: null,
        version: null,
        scope: null,
        copies: ['wb'],
      },
    ]);
  });

  test('an unknown repository answers 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/pipeline?repository=nope' });
    expect(response.statusCode).toBe(404);
  });
});

describe('PUT /api/settings/stage-files/:stage', () => {
  const pick = { rules: 'verify-b-rules.md' };

  test('refuses an unsigned save, an unknown signer and a stale before', async () => {
    const body = { repository: 'wb', before: null, after: pick };
    const unsigned = await put('verify', body);
    expect(unsigned.statusCode).toBe(400);
    expect(unsigned.json().error.code).toBe('signature_required');
    const unknown = await put('verify', { ...body, signedBy: 'nobody' });
    expect(unknown.json().error.code).toBe('signer_unknown');
    const stale = await put('verify', { ...body, before: { rules: 'x.md' }, signedBy: signer.id });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('settings_stale');
  });

  test('validates keys, kinds and slots against the scope', async () => {
    const save = (stage: string, after: object, repository: string | null = 'wb') =>
      put(stage, { repository, before: null, after, signedBy: signer.id });
    const errorOf = async (stage: string, after: object, repository?: string | null) =>
      (await save(stage, after, repository)).json().error;

    // A repository's copy is not visible at Global scope.
    expect(await errorOf('verify', pick, null)).toEqual({
      code: 'stage_file_unknown',
      params: { fileKey: 'verify-b-rules.md' },
    });
    expect(await errorOf('verify', { rules: 'lessons.md' })).toEqual({
      code: 'stage_file_kind',
      params: { fileKey: 'lessons.md', kind: 'document' },
    });
    expect(await errorOf('verify', { documents: ['lessons.md'] })).toMatchObject({
      code: 'stage_file_slot',
    });
    expect(await errorOf('verify', { prompt: '@built-in' })).toMatchObject({
      code: 'stage_file_slot',
      params: { slot: 'prompt' },
    });
    expect((await save('review', { prompt: '@built-in' })).statusCode).toBe(200);
    // Back to inheriting, for the tests below.
    await put('review', {
      repository: 'wb',
      before: { prompt: '@built-in' },
      after: null,
      signedBy: signer.id,
    });
  });

  test('a signed save overrides for the repository, logs one change, and a reset removes it', async () => {
    const saved = await put('verify', {
      repository: 'wb',
      before: null,
      after: pick,
      signedBy: signer.id,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().stage.slots[1]).toMatchObject({
      name: 'rules',
      source: 'repository',
      value: ['verify-b-rules.md'],
      files: [{ fileKey: 'verify-b-rules.md', scope: 'repository', version: 1 }],
    });
    const entity = `${wb.id}/verify`;
    expect(await changes(entity)).toEqual([
      expect.objectContaining({ actor: 'member', signerId: signer.id, before: null, after: pick }),
    ]);
    // Another repository still inherits.
    expect((await stageOf('verify', 'other')).slots[1]).toMatchObject({ source: 'default' });

    const reset = await put('verify', {
      repository: 'wb',
      before: pick,
      after: null,
      signedBy: signer.id,
    });
    expect(reset.statusCode).toBe(200);
    expect((await stageOf('verify', 'wb')).slots[1]).toMatchObject({
      source: 'default',
      value: ['verify-rules.md'],
    });
    expect(await changes(entity)).toHaveLength(2);
  });

  test('a global choice is inherited by repositories', async () => {
    const saved = await put('review', {
      repository: null,
      before: null,
      after: { documents: ['lessons.md'] },
      signedBy: signer.id,
    });
    expect(saved.statusCode).toBe(200);
    const atWb = await stageOf('review', 'wb');
    expect(atWb.choice).toEqual({ global: { documents: ['lessons.md'] }, repository: null });
    expect(atWb.slots[2]).toMatchObject({ source: 'global', value: ['lessons.md'] });
    expect(await changes('global/review')).toHaveLength(1);
  });
});
