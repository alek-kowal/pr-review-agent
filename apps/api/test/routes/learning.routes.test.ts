// S-23-T4: the Learning API. Each test makes its own repository, so the candidates and the
// `lessons.md` file are its own although api test files share a database.
import { resolveInstructions } from '@pra/core';
import {
  activeInstructionLayers,
  closeDb,
  createDb,
  createQueue,
  finishAnalysis,
  getRun,
  importInstructionV1,
  listSettingsChanges,
  startAnalysis,
  upsertPullRequest,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { LessonCandidateSchema } from '../../src/routes/api/learning/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
const queue = createQueue(testDatabaseUrl(), { max: 2, supervise: false, schedule: false });
queue.on('error', () => {});
let signer: { id: string; name: string };
let app: FastifyInstance;
let repository: Repository;
let prNumber = 0;

beforeAll(async () => {
  await queue.start();
  signer = await seedTeamMember(db, { name: 'Ola' });
});

afterAll(async () => {
  await queue.stop({ graceful: false }).catch(() => {});
  await closeDb(db);
});

beforeEach(async () => {
  const id = uniqueId();
  repository = await upsertRepository(db, { slug: `wb-${id}`, githubFullName: `acme-${id}/wb` });
  app = await build({ db, queue });
});

async function closedPr(state: 'merged' | 'closed' | 'open' = 'merged'): Promise<PullRequest> {
  prNumber += 1;
  const { pullRequest } = await upsertPullRequest(
    db,
    aPullRequest(repository.id, { number: 900 + prNumber, state }),
  );
  return pullRequest;
}

/** A candidate the analyst proposed on each of `prs` closed PRs; returns its id. */
async function candidateOn(prs: number, title = 'Snapshot tables in tests'): Promise<number> {
  let id: number | undefined;
  for (let i = 0; i < prs; i += 1) {
    const started = await startAnalysis(
      { db, queue },
      {
        pullRequestId: (await closedPr()).id,
        startedBy: 'hand',
      },
    );
    if (!started.started) throw new Error(started.reason);
    const result = await finishAnalysis(db, {
      analysisId: started.analysis.id,
      proposals: [{ title, lesson: 'Assert tables with a snapshot.', evidence: 'PR asked twice.' }],
    });
    if (!result.finished) throw new Error('analysis not finished');
    id ??= result.created[0];
  }
  return id!;
}

const post = (url: string, payload: object = {}) =>
  app.inject({ method: 'POST', url, headers: SAME_ORIGIN, payload });

const accept = (id: number, body: object = { signedBy: signer.id }) =>
  post(`/api/learning/candidates/${id}/accept`, body);

const lessonsOf = async () =>
  resolveInstructions(
    await activeInstructionLayers(db, { repositoryId: repository.id, level: 1 }),
    {
      repositoryId: repository.id,
      level: 1,
    },
  ).files.find((f) => f.fileKey === 'lessons.md');

describe('GET /api/learning/candidates', () => {
  test('lists a candidate with its PR count and source PRs', async () => {
    const id = await candidateOn(2);
    const response = await app.inject({ method: 'GET', url: '/api/learning/candidates' });
    expect(response.statusCode).toBe(200);
    const mine = (response.json() as { candidates: unknown[] }).candidates
      .map((c) => LessonCandidateSchema.parse(c))
      .find((c) => c.id === id);
    expect(mine).toMatchObject({
      repo: repository.slug,
      title: 'Snapshot tables in tests',
      status: 'proposed',
      prCount: 2,
      need: 2,
    });
    expect(mine!.sources).toHaveLength(2);
  });
});

describe('PUT /api/learning/candidates/:id', () => {
  test('edits the text unsigned', async () => {
    const id = await candidateOn(1);
    const response = await app.inject({
      method: 'PUT',
      url: `/api/learning/candidates/${id}`,
      headers: SAME_ORIGIN,
      payload: { title: 'Snapshot tables', text: 'Use one snapshot per table.' },
    });
    expect(response.statusCode).toBe(200);
    expect(LessonCandidateSchema.parse(response.json())).toMatchObject({
      title: 'Snapshot tables',
      text: 'Use one snapshot per table.',
    });
    expect(response.json().editedAt).not.toBeNull();
    expect(await listSettingsChanges(db, { area: 'learning', entity: String(id) })).toEqual([]);
  });
});

describe('POST /api/learning/candidates/:id/accept', () => {
  test('a 2-PR candidate becomes lessons.md version N+1, logged twice', async () => {
    await importInstructionV1(db, {
      scope: 'repository',
      repositoryId: repository.id,
      fileKey: 'lessons.md',
      content: '# Lessons\n\n- Name tests after behaviour.\n',
    });
    const id = await candidateOn(2);

    const response = await accept(id);

    expect(response.statusCode).toBe(200);
    const accepted = LessonCandidateSchema.parse(response.json());
    expect(accepted).toMatchObject({ status: 'accepted', lessonsVersion: 2, decidedBy: 'Ola' });
    const signed = await listSettingsChanges(db, { area: 'learning', entity: String(id) });
    expect(signed).toHaveLength(1);
    expect(signed[0]).toMatchObject({ actor: 'member', signerId: signer.id });
    expect(signed[0]!.after).toMatchObject({ status: 'accepted', lessonsVersion: 2 });
    const bot = (await listSettingsChanges(db, { area: 'instructions' })).filter(
      (c) => c.actor === 'bot' && (c.after as { version?: number })?.version === 2,
    );
    expect(bot.some((c) => (c.note ?? '').includes('Snapshot tables in tests'))).toBe(true);

    // The next resolved instructions for the repository include the lesson.
    const lessons = await lessonsOf();
    expect(lessons?.content).toContain('Snapshot tables in tests');
    expect(lessons?.content).toContain('Name tests after behaviour.');
    expect(lessons?.layers[0]).toMatchObject({ version: 2 });
  });

  test('a 1-PR candidate is refused with 409 needs_more_prs', async () => {
    const id = await candidateOn(1);
    const response = await accept(id);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: { code: 'needs_more_prs', params: { have: 1, need: 2 } },
    });
  });

  test('without a signature it is refused with 400 and nothing changes', async () => {
    const id = await candidateOn(2);
    const response = await accept(id, {});
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('signature_required');
    expect(await lessonsOf()).toBeUndefined();
  });

  test('a decided candidate is refused with 409 candidate_not_open', async () => {
    const id = await candidateOn(2);
    expect((await accept(id)).statusCode).toBe(200);
    const again = await accept(id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toEqual({
      code: 'candidate_not_open',
      params: { status: 'accepted' },
    });
  });
});

describe('POST /api/learning/candidates/:id/reject', () => {
  test('without a reason returns 400', async () => {
    const id = await candidateOn(1);
    const response = await post(`/api/learning/candidates/${id}/reject`, {
      signedBy: signer.id,
      reason: '  ',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('reason_required');
  });

  test('a signed reject with a reason is logged', async () => {
    const id = await candidateOn(1);
    const response = await post(`/api/learning/candidates/${id}/reject`, {
      signedBy: signer.id,
      reason: 'Too specific to one PR.',
    });
    expect(response.statusCode).toBe(200);
    expect(LessonCandidateSchema.parse(response.json())).toMatchObject({
      status: 'rejected',
      rejectReason: 'Too specific to one PR.',
    });
    const [change] = await listSettingsChanges(db, { area: 'learning', entity: String(id) });
    expect(change).toMatchObject({ signerId: signer.id, note: 'Too specific to one PR.' });
  });
});

describe('POST /api/learning/candidates/:id/draft', () => {
  test('"Try on a PR…" saves a lessons.md draft with the lesson', async () => {
    const id = await candidateOn(1);
    const response = await post(`/api/learning/candidates/${id}/draft`);
    expect(response.statusCode).toBe(201);
    const { fileId, versionId } = response.json();
    expect(fileId).toBeGreaterThan(0);
    expect(versionId).toBeGreaterThan(0);
  });
});

describe('POST /api/prs/:repo/:number/analyst', () => {
  test('starts the analyst by hand on a closed PR', async () => {
    const pullRequest = await closedPr('closed');
    const response = await post(`/api/prs/${repository.slug}/${pullRequest.number}/analyst`);
    expect(response.statusCode).toBe(202);
    const { runId } = response.json();
    expect(await getRun(db, runId)).toMatchObject({
      kind: 'analyst',
      status: 'queued',
      startedBy: 'hand',
    });
  });

  test('refuses an open PR with 409 pr_open', async () => {
    const pullRequest = await closedPr('open');
    const response = await post(`/api/prs/${repository.slug}/${pullRequest.number}/analyst`);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('pr_open');
  });
});
