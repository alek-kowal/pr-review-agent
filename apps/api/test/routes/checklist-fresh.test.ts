// S-12-T3: the PR page's checklist uses the stored CI and "changes requested", and once a push
// moved the head the PR is New commits and the merge route refuses with `head_moved`.
import {
  closeDb,
  createDb,
  storeChangesRequested,
  storePrCi,
  upsertPullRequest,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import { FakeGitHubGateway, fixturePullRequest } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
let app: FastifyInstance;
let github: FakeGitHubGateway;
let repository: Repository;

beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
});
afterAll(() => closeDb(db));
beforeEach(async () => {
  github = new FakeGitHubGateway();
  app = await build({ db, github });
});

async function readyPr(): Promise<PullRequest> {
  const pr = await seedPr(db, repository.id);
  await seedRound(db, pr);
  await storePrCi(db, pr.id, {
    sha: pr.headSha,
    checks: [{ name: 'build', conclusion: 'success' }],
  });
  return pr;
}

async function view(pr: PullRequest) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/prs/${repository.slug}/${pr.number}`,
  });
  expect(response.statusCode).toBe(200);
  const body = response.json();
  return {
    ...body,
    row: (item: string) => body.checklist.items.find((row: { item: string }) => row.item === item),
  };
}

describe('fresh checklist on the PR page', () => {
  test('stored green CI makes the checklist green at the head', async () => {
    const pr = await readyPr();
    const page = await view(pr);
    expect(page.checklist.ok).toBe(true);
    expect(page.row('ci_green')).toMatchObject({
      ok: true,
      reason: { code: 'checklist_ci_green', params: { passed: 1, sha: pr.headSha } },
    });
  });

  test('a failing check turns the CI row red', async () => {
    const pr = await readyPr();
    await storePrCi(db, pr.id, {
      sha: pr.headSha,
      checks: [
        { name: 'build', conclusion: 'success' },
        { name: 'lint', conclusion: 'failure' },
      ],
    });
    const page = await view(pr);
    expect(page.checklist.ok).toBe(false);
    expect(page.row('ci_green')).toMatchObject({
      ok: false,
      reason: { code: 'checklist_ci_failing', params: { failed: 1, total: 2, names: ['lint'] } },
    });
  });

  test('a changes request turns its row red', async () => {
    const pr = await readyPr();
    await storeChangesRequested(db, pr.id, ['tomek']);
    expect((await view(pr)).row('no_changes_requested')).toMatchObject({
      ok: false,
      reason: { code: 'checklist_changes_requested', params: { by: ['tomek'] } },
    });
  });

  test('after a push the PR is New commits and the merge refuses with head_moved', async () => {
    const pr = await readyPr();
    const moved = '5'.repeat(40);
    // What the `synchronize` webhook writes: the new head, at once.
    await upsertPullRequest(
      db,
      aPullRequest(repository.id, {
        number: pr.number,
        headSha: moved,
        commitsCount: pr.commitsCount + 1,
        updatedAt: new Date(Date.now() + 60_000),
      }),
    );
    const page = await view(pr);
    expect(page.nextStep).toMatchObject({ state: 'new_commits', lane: 'action_needed' });
    expect(page.row('ci_green').reason.code).toBe('checklist_ci_none');

    github.addPullRequest({
      ...fixturePullRequest('pull_request.synchronize'),
      fullName: repository.githubFullName,
      number: pr.number,
      headSha: moved,
    });
    const kasia = await seedTeamMember(db);
    const response = await app.inject({
      method: 'POST',
      url: `/api/prs/${repository.slug}/${pr.number}/merge`,
      headers: SAME_ORIGIN,
      payload: { typedNumber: pr.number, signedBy: kasia.id },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'head_moved',
      params: { reviewedSha: pr.headSha, headSha: moved },
    });
    expect(github.callsOf('squashMerge')).toEqual([]);
  });
});
