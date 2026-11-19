// S-08-T1: answers with one signature.
import {
  closeDb,
  createDb,
  timelineOf,
  upsertRepository,
  type PullRequest,
  type QuestionRow,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DecisionResult } from '../../src/routes/api/decisions/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  app = await build({ db });
});

let repository: Repository;
let kasia: { id: string; name: string };
let tomek: { id: string; name: string };
beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
  kasia = await seedTeamMember(db, { name: 'Kasia' });
  tomek = await seedTeamMember(db, { name: 'Tomek' });
});

/** A PR whose round 1 asked 2 questions (options "Yes" and "No") and found 1 finding. */
async function askedPr(): Promise<{ pr: PullRequest; questions: QuestionRow[] }> {
  const pr = await seedPr(db, repository.id);
  const { questions } = await seedRound(db, pr, { findings: [{}], questions: 2 });
  return { pr, questions };
}

function answer(pr: PullRequest, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/answers`,
    headers: SAME_ORIGIN,
    payload: body,
  });
}

describe('POST /api/prs/:repo/:number/answers', () => {
  test('two answers save with one signer in one transaction, and the PR leaves questions_waiting', async () => {
    const { pr, questions } = await askedPr();
    const [first, second] = questions;
    const before = await app.inject({ url: `/api/prs/${repository.slug}/${pr.number}` });
    expect(before.json().nextStep.state).toBe('questions_waiting');

    const response = await answer(pr, {
      signedBy: tomek.id,
      answers: [
        { questionId: first!.id, option: 1, expectedAnswerId: null },
        { questionId: second!.id, ownText: 'Only in production.', expectedAnswerId: null },
      ],
    });

    expect(response.statusCode).toBe(200);
    const body = DecisionResult.parse(response.json());
    expect(body.findings.questions.map((q) => q.answer)).toEqual([
      expect.objectContaining({ option: 1, text: 'No', signedBy: { id: tomek.id, name: 'Tomek' } }),
      expect.objectContaining({
        option: null,
        text: 'Only in production.',
        signedBy: { id: tomek.id, name: 'Tomek' },
      }),
    ]);
    // One save: both answers share the moment they were saved, and the Timeline has one entry.
    const [a, b] = body.findings.questions.map((q) => q.answer!);
    expect(a!.savedAt).toBe(b!.savedAt);
    expect(body.nextStep.state).not.toBe('questions_waiting');
    expect(body.nextStep.state).toBe('findings_to_decide');
    const timeline = await timelineOf(db, pr.id);
    expect(timeline.filter((entry) => entry.kind === 'questions_answered')).toEqual([
      expect.objectContaining({ memberId: tomek.id, params: { count: 2 } }),
    ]);
  });

  test('an own-text answer is accepted on its own', async () => {
    const { pr, questions } = await askedPr();
    const response = await answer(pr, {
      signedBy: kasia.id,
      answers: [{ questionId: questions[0]!.id, ownText: 'Keep it.', expectedAnswerId: null }],
    });
    expect(response.statusCode).toBe(200);
    const body = DecisionResult.parse(response.json());
    expect(body.findings.questions[0]!.answer).toMatchObject({ option: null, text: 'Keep it.' });
    // One question is still open.
    expect(body.nextStep.state).toBe('questions_waiting');
  });

  test('a missing signer is 400 signature_required and saves nothing', async () => {
    const { pr, questions } = await askedPr();
    const response = await answer(pr, {
      answers: [{ questionId: questions[0]!.id, option: 0, expectedAnswerId: null }],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'signature_required', params: {} } });
  });

  test('an unknown signer, an empty answer and an option out of range are 400', async () => {
    const { pr, questions } = await askedPr();
    const id = questions[0]!.id;
    const unknown = await answer(pr, {
      signedBy: '00000000-0000-4000-8000-000000000000',
      answers: [{ questionId: id, option: 0, expectedAnswerId: null }],
    });
    expect(unknown.json().error.code).toBe('signer_unknown');
    const empty = await answer(pr, {
      signedBy: tomek.id,
      answers: [{ questionId: id, ownText: '  ', expectedAnswerId: null }],
    });
    expect(empty.json().error).toEqual({ code: 'answer_invalid', params: { questionIds: [id] } });
    const outOfRange = await answer(pr, {
      signedBy: tomek.id,
      answers: [{ questionId: id, option: 2, expectedAnswerId: null }],
    });
    expect(outOfRange.json().error).toEqual({
      code: 'answer_invalid',
      params: { questionIds: [id] },
    });
  });

  test("another PR's question is 404 question_not_found", async () => {
    const { pr } = await askedPr();
    const other = await askedPr();
    const response = await answer(pr, {
      signedBy: tomek.id,
      answers: [{ questionId: other.questions[0]!.id, option: 0, expectedAnswerId: null }],
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('question_not_found');
  });

  test('a save over a newer answer is 409 naming the earlier signer, and writes nothing', async () => {
    const { pr, questions } = await askedPr();
    const [first, second] = questions;
    // Kasia answers the first question while Tomek still sees both open.
    const kasias = await answer(pr, {
      signedBy: kasia.id,
      answers: [{ questionId: first!.id, option: 0, expectedAnswerId: null }],
    });
    expect(kasias.statusCode).toBe(200);

    const response = await answer(pr, {
      signedBy: tomek.id,
      answers: [
        { questionId: first!.id, option: 1, expectedAnswerId: null },
        { questionId: second!.id, option: 1, expectedAnswerId: null },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      code: 'answer_conflict',
      params: {
        conflicts: [
          {
            questionId: first!.id,
            answer: { text: 'Yes', signedBy: { id: kasia.id, name: 'Kasia' } },
          },
        ],
      },
    });
    const view = await app.inject({ url: `/api/prs/${repository.slug}/${pr.number}/findings` });
    const answers = view.json().questions.map((q: { answer: unknown }) => q.answer);
    expect(answers[0]).toMatchObject({ signedBy: { name: 'Kasia' } });
    expect(answers[1]).toBeNull();

    // Seen, Kasia's answer can be replaced.
    const replaced = await answer(pr, {
      signedBy: tomek.id,
      answers: [{ questionId: first!.id, option: 1, expectedAnswerId: answers[0].id }],
    });
    expect(replaced.statusCode).toBe(200);
    expect(DecisionResult.parse(replaced.json()).findings.questions[0]!.answer).toMatchObject({
      text: 'No',
      signedBy: { name: 'Tomek' },
    });
  });
});
