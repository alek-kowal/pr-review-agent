import {
  closeDb,
  createDb,
  listDecisionBatches,
  removeTeamMember,
  upsertRepository,
  type FindingRow,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DecideResponse, DecisionResult } from '../../src/routes/api/decisions/index.ts';
import { FindingsResponse } from '../../src/routes/api/prs/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

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

/** A PR whose round 1 found 2 Blocking findings and 1 Worth fixing. */
async function reviewedPr(): Promise<{ pr: PullRequest; findings: FindingRow[] }> {
  const pr = await seedPr(db, repository.id);
  const { findings } = await seedRound(db, pr, { findings: [...blocking(2), {}] });
  return { pr, findings };
}

const versions = (findings: Pick<FindingRow, 'id' | 'version'>[]) =>
  Object.fromEntries(findings.map((f) => [f.id, f.version]));

function decide(pr: PullRequest, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/decisions`,
    headers: SAME_ORIGIN,
    payload: body,
  });
}

const undo = (batchId: number) =>
  app.inject({
    method: 'POST',
    url: `/api/decision-batches/${batchId}/undo`,
    headers: SAME_ORIGIN,
  });

async function findingsOf(pr: PullRequest) {
  const response = await app.inject({
    url: `/api/prs/${repository.slug}/${pr.number}/findings`,
  });
  return FindingsResponse.parse(response.json()).findings;
}

describe('POST /api/prs/:repo/:number/decisions', () => {
  test('a bulk Implement of 2 findings with one signer decides both, and 2 wait for a fix', async () => {
    const { pr, findings } = await reviewedPr();
    const [first, second, third] = findings;
    await decide(pr, {
      findingIds: [third!.id],
      decision: 'reject',
      reason: 'Out of scope',
      signedBy: tomek.id,
      expectedVersions: versions([third!]),
    });

    const response = await decide(pr, {
      findingIds: [first!.id, second!.id],
      decision: 'implement',
      signedBy: kasia.id,
      expectedVersions: versions([first!, second!]),
    });
    expect(response.statusCode).toBe(200);
    const body = DecideResponse.parse(response.json());
    expect(body.nextStep).toMatchObject({
      state: 'waiting_for_fix',
      banner: { code: 'state_waiting_for_fix', params: { count: 2 } },
    });
    expect(body.checklist.items.find((i) => i.item === 'nothing_waiting_for_fix')).toMatchObject({
      ok: false,
      reason: { params: { count: 2 } },
    });
    const decided = body.findings.findings.filter((f) => f.decision?.decision === 'implement');
    expect(decided.map((f) => f.id)).toEqual([first!.id, second!.id]);
    expect(decided.every((f) => f.decision!.batchId === body.batchId)).toBe(true);
    expect(decided[0]!.decision!.signedBy).toEqual({ id: kasia.id, name: 'Kasia' });
    expect(decided[0]!.version).toBe(first!.version + 1);

    // One batch row for both findings.
    const batches = await listDecisionBatches(db, pr.id);
    expect(batches[0]).toMatchObject({ id: body.batchId, findingIds: [first!.id, second!.id] });
  });

  test('Reject without a reason gives 400 reason_required', async () => {
    const { pr, findings } = await reviewedPr();
    for (const reason of [undefined, '', '   ']) {
      const response = await decide(pr, {
        findingIds: [findings[0]!.id],
        decision: 'reject',
        reason,
        signedBy: kasia.id,
        expectedVersions: versions(findings),
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('reason_required');
    }
  });

  test('no signature, an unknown or removed signer give 400', async () => {
    const { pr, findings } = await reviewedPr();
    const base = {
      findingIds: [findings[0]!.id],
      decision: 'implement',
      expectedVersions: versions(findings),
    };
    const unsigned = await decide(pr, base);
    expect(unsigned.statusCode).toBe(400);
    expect(unsigned.json().error.code).toBe('signature_required');

    const gone = await seedTeamMember(db);
    await removeTeamMember(db, gone.id);
    for (const signedBy of ['not-a-member', gone.id]) {
      const response = await decide(pr, { ...base, signedBy });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: { code: 'signer_unknown', params: { signer: signedBy } },
      });
    }
  });

  test('stale expectedVersions give 409 decision_conflict naming the other signer', async () => {
    const { pr, findings } = await reviewedPr();
    const seen = versions(findings);
    const first = await decide(pr, {
      findingIds: [findings[0]!.id],
      decision: 'reject',
      reason: 'Intended',
      signedBy: tomek.id,
      expectedVersions: seen,
    });
    expect(first.statusCode).toBe(200);

    const second = await decide(pr, {
      findingIds: [findings[0]!.id, findings[1]!.id],
      decision: 'implement',
      signedBy: kasia.id,
      expectedVersions: seen,
    });
    expect(second.statusCode).toBe(409);
    const { error } = second.json();
    expect(error.code).toBe('decision_conflict');
    expect(error.params.conflicts).toEqual([
      expect.objectContaining({
        findingId: findings[0]!.id,
        decision: expect.objectContaining({
          decision: 'reject',
          reason: 'Intended',
          signedBy: { id: tomek.id, name: 'Tomek' },
        }),
      }),
    ]);
    // Nothing of the second batch was written.
    expect((await findingsOf(pr))[1]!.decision).toBeNull();
  });

  test("another PR's finding gives 404, an unknown PR too", async () => {
    const { pr } = await reviewedPr();
    const other = await reviewedPr();
    const response = await decide(pr, {
      findingIds: [other.findings[0]!.id],
      decision: 'implement',
      signedBy: kasia.id,
      expectedVersions: versions(other.findings),
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toEqual({
      code: 'finding_not_found',
      params: { missing: [other.findings[0]!.id] },
    });

    const unknown = await app.inject({
      method: 'POST',
      url: `/api/prs/${repository.slug}/99999/decisions`,
      headers: SAME_ORIGIN,
      payload: { findingIds: [1], decision: 'defer', signedBy: kasia.id, expectedVersions: {} },
    });
    expect(unknown.statusCode).toBe(404);
  });

  test('Nits may be decided, and Defer only records the decision', async () => {
    const pr = await seedPr(db, repository.id);
    const { findings } = await seedRound(db, pr, { findings: [{ severity: 'nit' }, {}] });
    const response = await decide(pr, {
      findingIds: findings.map((f) => f.id),
      decision: 'defer',
      signedBy: kasia.id,
      expectedVersions: versions(findings),
    });
    expect(response.statusCode).toBe(200);
    const body = DecideResponse.parse(response.json());
    expect(body.findings.findings.map((f) => f.decision?.decision)).toEqual(['defer', 'defer']);
    expect(body.nextStep.state).toBe('ready_to_merge');
  });

  test('without the CSRF headers the request is refused', async () => {
    const { pr, findings } = await reviewedPr();
    const response = await app.inject({
      method: 'POST',
      url: `/api/prs/${repository.slug}/${pr.number}/decisions`,
      payload: {
        findingIds: [findings[0]!.id],
        decision: 'implement',
        signedBy: kasia.id,
        expectedVersions: versions(findings),
      },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('POST /api/decision-batches/:id/undo', () => {
  test('undo restores the earlier view', async () => {
    const { pr, findings } = await reviewedPr();
    const before = await app.inject({ url: `/api/prs/${repository.slug}/${pr.number}` });

    const decided = DecideResponse.parse(
      (
        await decide(pr, {
          findingIds: findings.map((f) => f.id),
          decision: 'reject',
          reason: 'Not a bug',
          signedBy: kasia.id,
          expectedVersions: versions(findings),
        })
      ).json(),
    );
    expect(decided.nextStep.state).toBe('ready_to_merge');

    const response = await undo(decided.batchId);
    expect(response.statusCode).toBe(200);
    const undone = DecisionResult.parse(response.json());
    expect(undone.nextStep).toEqual(before.json().nextStep);
    expect(undone.checklist).toEqual(before.json().checklist);
    expect(undone.findings.findings.every((f) => f.decision === null)).toBe(true);

    const again = await undo(decided.batchId);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('decision_already_undone');
  });

  test('undo falls back to the previous decision, and is refused once a finding changed since', async () => {
    const { pr, findings } = await reviewedPr();
    const [finding] = findings;
    const first = DecideResponse.parse(
      (
        await decide(pr, {
          findingIds: [finding!.id],
          decision: 'implement',
          signedBy: kasia.id,
          expectedVersions: versions([finding!]),
        })
      ).json(),
    );
    const second = DecideResponse.parse(
      (
        await decide(pr, {
          findingIds: [finding!.id],
          decision: 'reject',
          reason: 'Changed my mind',
          signedBy: tomek.id,
          expectedVersions: { [finding!.id]: finding!.version + 1 },
        })
      ).json(),
    );

    const refused = await undo(first.batchId);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toEqual({
      code: 'decision_changed_since',
      params: { findingIds: [finding!.id] },
    });

    const undone = DecisionResult.parse((await undo(second.batchId)).json());
    expect(undone.findings.findings[0]!.decision).toMatchObject({
      decision: 'implement',
      batchId: first.batchId,
    });
  });

  test('an unknown batch gives 404', async () => {
    const response = await undo(999999);
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('decision_batch_not_found');
  });
});
