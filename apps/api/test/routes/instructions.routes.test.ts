// S-22-T4: the Instructions API. Files are repository copies of a repository unique to each test,
// since api test files share a database (and its global files).
import {
  closeDb,
  createDb,
  freezeRunInstructions,
  importInstructionV1,
  insertRun,
  listSettingsChanges,
  upsertPullRequest,
  upsertRepository,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRun, seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  InstructionDetailResponse,
  InstructionsListResponse,
} from '../../src/routes/api/instructions/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
let signer: { id: string; name: string };
let app: FastifyInstance;
let repository: Repository;
let fileId: number;
let v1Id: number;
/** A file key unique to the test, so its level copies are too. */
let key: string;

beforeAll(async () => {
  signer = await seedTeamMember(db, { name: 'Ola' });
});

afterAll(async () => {
  await closeDb(db);
});

beforeEach(async () => {
  const id = uniqueId();
  key = `rules-${id}.md`;
  repository = await upsertRepository(db, { slug: `wb-${id}`, githubFullName: `acme-${id}/wb` });
  const { version } = await importInstructionV1(db, {
    scope: 'repository',
    repositoryId: repository.id,
    fileKey: key,
    content: 'one\ntwo\n',
  });
  fileId = version.fileId;
  v1Id = version.id;
  app = await build({ db });
});

const send = (method: 'POST' | 'PUT', url: string, payload: object) =>
  app.inject({ method, url, headers: SAME_ORIGIN, payload });

const saveDraft = (content = 'one\nthree\n', note: string | null = 'Sharper rule') =>
  send('PUT', `/api/instructions/${fileId}/draft`, { content, note });

const detailOf = (body: unknown) => InstructionDetailResponse.parse(body);

const changes = () => listSettingsChanges(db, { area: 'instructions', entity: String(fileId) });

describe('GET /api/instructions', () => {
  test('lists the file under its repository with the active version and no draft', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/instructions' });
    expect(response.statusCode).toBe(200);
    const { files } = InstructionsListResponse.parse(response.json());
    const mine = files.find((f) => f.id === fileId);
    expect(mine).toMatchObject({
      scope: 'repository',
      repository: { id: repository.id, slug: repository.slug },
      level: null,
      fileKey: key,
      active: { id: v1Id, version: 1 },
      draft: null,
    });
    // Global files come before repository copies.
    const scopes = files.map((f) => f.scope);
    expect(scopes.lastIndexOf('global')).toBeLessThan(scopes.indexOf('repository'));
  });

  test('gaps name the required files a repository lacks, per level (INSTR)', async () => {
    // Empty repository copies hide any global verifier files.
    for (const fileKey of ['prompt-verifier.md', 'verify-rules.md']) {
      await importInstructionV1(db, {
        scope: 'repository',
        repositoryId: repository.id,
        fileKey,
        content: '',
      });
    }
    const response = await app.inject({ method: 'GET', url: '/api/instructions' });
    const { gaps } = InstructionsListResponse.parse(response.json());
    const mine = gaps.find((g) => g.repository.id === repository.id);
    const verify = mine?.gaps.filter((g) => g.stage === 'verify');
    expect(verify?.map((g) => g.level)).toEqual([3, 4, 5, 6]);
    expect(verify?.[0]?.missing).toEqual(['prompt-verifier.md', 'verify-rules.md']);
  });

  test('a missing file answers 404', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/instructions/999999999' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('instruction_file_not_found');
  });
});

describe('PUT /api/instructions/:id/draft', () => {
  test('saving a draft writes no settings change, and saving again updates the same draft', async () => {
    const first = await saveDraft();
    expect(first.statusCode).toBe(200);
    expect(detailOf(first.json()).versions[0]).toMatchObject({
      version: 2,
      status: 'draft',
      content: 'one\nthree\n',
      note: 'Sharper rule',
      author: 'hand',
      authorName: null,
    });

    const second = detailOf((await saveDraft('one\nfour\n', null)).json());
    expect(second.versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'draft'],
      [1, 'active'],
    ]);
    expect(second.versions[0]!.content).toBe('one\nfour\n');
    expect(await changes()).toEqual([]);
  });
});

describe('POST /api/instructions/:id/activate and /rollback', () => {
  test('activate writes one settings change and archives the old active version', async () => {
    const draftId = detailOf((await saveDraft()).json()).versions[0]!.id;

    const response = await send('POST', `/api/instructions/${fileId}/activate`, {
      versionId: draftId,
      activeVersion: 1,
      signedBy: signer.id,
    });

    expect(response.statusCode).toBe(200);
    const { versions } = detailOf(response.json());
    expect(versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'active'],
      [1, 'archived'],
    ]);
    expect(versions[0]).toMatchObject({ signerName: 'Ola', note: 'Sharper rule' });
    const logged = await changes();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      actor: 'member',
      signerId: signer.id,
      before: { fileKey: key, version: 1 },
      after: { fileKey: key, version: 2, added: 1, removed: 1 },
      note: 'Sharper rule',
    });
  });

  test('rollback re-activates an older version', async () => {
    const draftId = detailOf((await saveDraft()).json()).versions[0]!.id;
    await send('POST', `/api/instructions/${fileId}/activate`, {
      versionId: draftId,
      signedBy: signer.id,
    });

    const response = await send('POST', `/api/instructions/${fileId}/rollback`, {
      versionId: v1Id,
      activeVersion: 2,
      signedBy: signer.id,
    });

    expect(response.statusCode).toBe(200);
    expect(detailOf(response.json()).versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'archived'],
      [1, 'active'],
    ]);
    expect((await changes()).map((c) => [c.before, c.after])).toEqual([
      [
        { fileKey: key, version: 2 },
        { fileKey: key, version: 1, added: 1, removed: 1 },
      ],
      [
        { fileKey: key, version: 1 },
        { fileKey: key, version: 2, added: 1, removed: 1 },
      ],
    ]);
  });

  test('an unsigned activate returns 400 and changes nothing', async () => {
    const draftId = detailOf((await saveDraft()).json()).versions[0]!.id;

    const response = await send('POST', `/api/instructions/${fileId}/activate`, {
      versionId: draftId,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('signature_required');
    const { versions } = detailOf(
      (await app.inject({ method: 'GET', url: `/api/instructions/${fileId}` })).json(),
    );
    expect(versions.map((v) => v.status)).toEqual(['draft', 'active']);
    expect(await changes()).toEqual([]);
  });

  test('a stale active version gives 409, and activate takes only the draft', async () => {
    const draftId = detailOf((await saveDraft()).json()).versions[0]!.id;
    const stale = await send('POST', `/api/instructions/${fileId}/activate`, {
      versionId: draftId,
      activeVersion: 7,
      signedBy: signer.id,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('settings_stale');

    const notDraft = await send('POST', `/api/instructions/${fileId}/activate`, {
      versionId: v1Id,
      signedBy: signer.id,
    });
    expect(notDraft.statusCode).toBe(409);
    expect(notDraft.json().error).toEqual({
      code: 'instruction_version_status',
      params: { status: 'active' },
    });
  });
});

describe('GET /api/instructions/:id', () => {
  test('the history lists the runs that read each version', async () => {
    const { pullRequest } = await upsertPullRequest(
      db,
      aPullRequest(repository.id, { number: 272 }),
    );
    const run = await insertRun(db, aRun(pullRequest.id, { levelNumber: 1 }));
    await freezeRunInstructions(db, { id: run.id, level: { number: 1 } }, repository.id);

    const response = await app.inject({ method: 'GET', url: `/api/instructions/${fileId}` });

    const v1 = detailOf(response.json()).versions.find((v) => v.version === 1)!;
    expect(v1.runCount).toBe(1);
    expect(v1.runs).toEqual([
      expect.objectContaining({
        runId: run.id,
        kind: 'round',
        prNumber: 272,
        repositorySlug: repository.slug,
      }),
    ]);
  });
});

describe('POST /api/instructions/:id/copies', () => {
  test('starts a level copy as a draft with the active text; a second one is refused', async () => {
    const copy = () =>
      send('POST', `/api/instructions/${fileId}/copies`, { scope: 'level', level: 4 });
    const response = await copy();
    expect(response.statusCode).toBe(201);
    const started = detailOf(response.json());
    expect(started.file).toMatchObject({ scope: 'level', level: 4, fileKey: key });
    expect(started.versions).toEqual([
      expect.objectContaining({ version: 1, status: 'draft', content: 'one\ntwo\n' }),
    ]);

    const again = await copy();
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('instruction_copy_exists');
  });

  test('starts a repository copy of a file in another repository', async () => {
    const other = await upsertRepository(db, {
      slug: `other-${uniqueId()}`,
      githubFullName: `acme-${uniqueId()}/other`,
    });
    const response = await send('POST', `/api/instructions/${fileId}/copies`, {
      scope: 'repository',
      repository: other.slug,
    });
    expect(response.statusCode).toBe(201);
    expect(detailOf(response.json()).file.repository).toEqual({ id: other.id, slug: other.slug });

    const again = await send('POST', `/api/instructions/${fileId}/copies`, {
      scope: 'repository',
      repository: other.slug,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('instruction_copy_exists');
  });
});
