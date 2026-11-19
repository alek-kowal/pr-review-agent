// S-08-T5: who usually decides, and decision labels naming the signer and the author (FR-041).
import { randomUUID } from 'node:crypto';
import { closeDb, createDb, upsertRepository, type PullRequest, type Repository } from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { FindingsResponse } from '../../src/routes/api/prs/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 4 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  app = await build({ db });
});

let repository: Repository;
let kasia: { id: string; name: string; githubLogin: string };
let tomek: { id: string; name: string };
beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
  kasia = await seedTeamMember(db, { name: 'Kasia', githubLogin: `kasia-${randomUUID()}` });
  tomek = await seedTeamMember(db, { name: 'Tomek' });
});

async function findingsOf(pr: PullRequest) {
  const response = await app.inject({ url: `/api/prs/${repository.slug}/${pr.number}/findings` });
  return FindingsResponse.parse(response.json()).findings;
}

async function decide(pr: PullRequest, findingId: number, signedBy: string) {
  const [finding] = (await findingsOf(pr)).filter((f) => f.id === findingId);
  const response = await app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/decisions`,
    headers: SAME_ORIGIN,
    payload: {
      findingIds: [findingId],
      decision: 'reject',
      reason: 'Out of scope',
      signedBy,
      expectedVersions: { [findingId]: finding!.version },
    },
  });
  expect(response.statusCode).toBe(200);
}

describe('decision labels', () => {
  test('every finding to decide names its usual decider: the author, by Team member', async () => {
    const pr = await seedPr(db, repository.id, { authorLogin: kasia.githubLogin.toUpperCase() });
    await seedRound(db, pr, { findings: [...blocking(1), { severity: 'nit' }] });

    const [toDecide, nit] = await findingsOf(pr);
    expect(toDecide!.usuallyDecidedBy).toEqual({
      login: kasia.githubLogin.toUpperCase(),
      memberId: kasia.id,
      name: 'Kasia',
    });
    expect(nit!.usuallyDecidedBy).toBeNull();
  });

  test('an author outside the Team is named by login', async () => {
    const pr = await seedPr(db, repository.id, { authorLogin: 'outsider-dev' });
    await seedRound(db, pr, { findings: blocking(1) });
    const [finding] = await findingsOf(pr);
    expect(finding!.usuallyDecidedBy).toEqual({
      login: 'outsider-dev',
      memberId: null,
      name: null,
    });

    await decide(pr, finding!.id, tomek.id);
    const [decided] = await findingsOf(pr);
    expect(decided!.decision!.label).toEqual({ signer: 'Tomek', author: 'outsider-dev' });
  });

  test('signer other than the author gives both names; the author signing gives one', async () => {
    const pr = await seedPr(db, repository.id, { authorLogin: kasia.githubLogin });
    const { findings } = await seedRound(db, pr, { findings: blocking(2) });

    await decide(pr, findings[0]!.id, tomek.id);
    await decide(pr, findings[1]!.id, kasia.id);

    const [byTomek, byKasia] = await findingsOf(pr);
    expect(byTomek!.decision).toMatchObject({
      signedBy: { id: tomek.id, name: 'Tomek' },
      author: { memberId: kasia.id, name: 'Kasia' },
      label: { signer: 'Tomek', author: 'Kasia' },
    });
    expect(byTomek!.usuallyDecidedBy).toBeNull();
    expect(byKasia!.decision!.label).toEqual({ signer: 'Kasia', author: null });
  });
});
