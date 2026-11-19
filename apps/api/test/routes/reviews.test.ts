// S-08-T4: signed opinions and signed reviews.
import {
  closeDb,
  createDb,
  reviewsOf,
  timelineOf,
  upsertRepository,
  type FindingRow,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { FindingsResponse } from '../../src/routes/api/prs/index.ts';
import { ReviewResponse } from '../../src/routes/api/reviews/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 4 });
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

/** A PR whose round 1 found 2 Blocking findings and 1 nit. */
async function reviewedPr(): Promise<{ pr: PullRequest; findings: FindingRow[] }> {
  const pr = await seedPr(db, repository.id);
  const { findings } = await seedRound(db, pr, {
    findings: [...blocking(2), { severity: 'nit' }],
  });
  return { pr, findings };
}

function review(pr: PullRequest, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/reviews`,
    headers: SAME_ORIGIN,
    payload: body,
  });
}

async function findingsOf(pr: PullRequest) {
  const response = await app.inject({ url: `/api/prs/${repository.slug}/${pr.number}/findings` });
  return FindingsResponse.parse(response.json()).findings;
}

describe('POST /api/prs/:repo/:number/reviews', () => {
  test('3 opinions save as one signed review with counts 2/1, a nit included', async () => {
    const { pr, findings } = await reviewedPr();
    const [first, second, nit] = findings;

    const response = await review(pr, {
      signedBy: tomek.id,
      opinions: [
        { findingId: first!.id, value: 'worth' },
        { findingId: second!.id, value: 'not_worth', comment: 'Rare in practice.' },
        { findingId: nit!.id, value: 'worth' },
      ],
    });

    expect(response.statusCode).toBe(200);
    const body = ReviewResponse.parse(response.json());
    expect(body.review).toMatchObject({
      signedBy: { id: tomek.id, name: 'Tomek' },
      worth: 2,
      notWorth: 1,
    });
    expect(await reviewsOf(db, pr.id)).toEqual([
      expect.objectContaining({ id: body.review.id, worth: 2, notWorth: 1 }),
    ]);
    expect(body.findings.findings.map((f) => f.opinions.map((o) => [o.value, o.comment]))).toEqual([
      [['worth', null]],
      [['not_worth', 'Rare in practice.']],
      [['worth', null]],
    ]);
    expect(body.findings.findings[0]!.opinions[0]).toMatchObject({ fromRound: 1, carried: false });
    // The banner counts the people who gave opinions.
    expect(body.nextStep.banner).toMatchObject({ params: { reviewers: 1 } });
    const timeline = await timelineOf(db, pr.id);
    expect(timeline.filter((e) => e.kind === 'review_saved')).toEqual([
      expect.objectContaining({
        memberId: tomek.id,
        params: { worth: 2, notWorth: 1, reviewId: body.review.id },
      }),
    ]);
  });

  test("two people's opinions on one finding are both listed with names; a newer one replaces only the signer's own", async () => {
    const { pr, findings } = await reviewedPr();
    const id = findings[0]!.id;
    await review(pr, { signedBy: tomek.id, opinions: [{ findingId: id, value: 'worth' }] });
    await review(pr, { signedBy: kasia.id, opinions: [{ findingId: id, value: 'not_worth' }] });
    await review(pr, {
      signedBy: tomek.id,
      opinions: [{ findingId: id, value: 'not_worth', comment: 'On second thought.' }],
    });

    const [finding] = await findingsOf(pr);
    expect(finding!.opinions.map((o) => [o.signedBy.name, o.value, o.comment])).toEqual(
      expect.arrayContaining([
        ['Kasia', 'not_worth', null],
        ['Tomek', 'not_worth', 'On second thought.'],
      ]),
    );
    expect(finding!.opinions).toHaveLength(2);
    expect(await reviewsOf(db, pr.id)).toHaveLength(3);
  });

  test('two concurrent saves by different signers both persist', async () => {
    const { pr, findings } = await reviewedPr();
    const opinions = findings.slice(0, 2).map((f) => ({ findingId: f.id, value: 'worth' }));
    const [a, b] = await Promise.all([
      review(pr, { signedBy: tomek.id, opinions }),
      review(pr, { signedBy: kasia.id, opinions }),
    ]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    const listed = await findingsOf(pr);
    for (const finding of listed.slice(0, 2)) {
      expect(finding.opinions.map((o) => o.signedBy.name).sort()).toEqual(['Kasia', 'Tomek']);
    }
  });

  test('a missing or unknown signer is 400; a finding of another PR is 404', async () => {
    const { pr, findings } = await reviewedPr();
    const other = await reviewedPr();
    const opinions = [{ findingId: findings[0]!.id, value: 'worth' }];
    const missing = await review(pr, { opinions });
    expect(missing.json().error.code).toBe('signature_required');
    const unknown = await review(pr, {
      signedBy: '00000000-0000-4000-8000-000000000000',
      opinions,
    });
    expect(unknown.json().error.code).toBe('signer_unknown');
    const foreign = await review(pr, {
      signedBy: tomek.id,
      opinions: [{ findingId: other.findings[0]!.id, value: 'worth' }],
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('finding_not_found');
    expect(await reviewsOf(db, pr.id)).toEqual([]);
  });
});
