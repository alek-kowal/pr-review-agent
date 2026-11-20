// S-12-T2: merge from the app. The typed number and the signature are checked, every checklist
// row is re-checked on fresh GitHub state, and the squash merge is pinned to the reviewed SHA.
import {
  and,
  closeDb,
  createDb,
  eq,
  schema,
  storePrCi,
  upsertRepository,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import { FakeGitHubGateway, fixturePullRequest } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 4 });
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

const GREEN = [{ name: 'build', conclusion: 'success' as const }];

/** A reviewed PR with nothing left to decide, CI green in the DB, and GitHub agreeing. */
async function readyPr(patch: { body?: string } = {}): Promise<PullRequest> {
  const pr = await seedPr(db, repository.id, { title: 'Edge labels', ...patch });
  await seedRound(db, pr);
  await storePrCi(db, pr.id, { sha: pr.headSha, checks: GREEN });
  github.addPullRequest({
    ...fixturePullRequest('pull_request.ready_for_review'),
    fullName: repository.githubFullName,
    number: pr.number,
    headSha: pr.headSha,
    title: pr.title,
  });
  github.setCiChecks(repository.githubFullName, pr.headSha, [
    { name: 'build', source: 'check_run', state: 'passed' },
  ]);
  return pr;
}

const merge = (pr: PullRequest, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/merge`,
    headers: SAME_ORIGIN,
    payload,
  });

const timeline = (pr: PullRequest, kind: string) =>
  db
    .select()
    .from(schema.timelineEntries)
    .where(
      and(eq(schema.timelineEntries.pullRequestId, pr.id), eq(schema.timelineEntries.kind, kind)),
    );

const stored = async (pr: PullRequest) =>
  (await db.select().from(schema.pullRequests).where(eq(schema.pullRequests.id, pr.id)))[0]!;

describe('merge', () => {
  test('a wrong typed number is 400 and nothing is asked of GitHub', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db, { name: 'Kasia' });

    const response = await merge(pr, { typedNumber: pr.number + 1, signedBy: kasia.id });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('merge_number_mismatch');
    expect(github.calls).toEqual([]);
  });

  test('an unsigned merge is 400 signature_required, an unknown signer signer_unknown', async () => {
    const pr = await readyPr();
    const unsigned = await merge(pr, { typedNumber: pr.number });
    expect(unsigned.statusCode).toBe(400);
    expect(unsigned.json().error.code).toBe('signature_required');

    const unknown = await merge(pr, {
      typedNumber: pr.number,
      signedBy: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('signer_unknown');
  });

  test('without the GitHub App a merge is 409 github_read_only, with nothing asked of GitHub', async () => {
    const pr = await readyPr();
    github.setMode('token');

    const response = await merge(pr, {
      typedNumber: pr.number,
      signedBy: '00000000-0000-4000-8000-000000000000',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('github_read_only');
    expect(github.calls).toEqual([]);
  });

  test('a fresh head that is not the reviewed SHA is 409 head_moved, with no merge call', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db);
    const key = `${repository.githubFullName}#${pr.number}`;
    github.pullRequests.set(key, { ...github.pullRequests.get(key)!, headSha: 'f'.repeat(40) });

    const response = await merge(pr, { typedNumber: pr.number, signedBy: kasia.id });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'head_moved',
      params: { reviewedSha: pr.headSha, headSha: 'f'.repeat(40) },
    });
    expect(github.callsOf('squashMerge')).toEqual([]);
  });

  test('CI red on fresh state but green in the DB is 409 with the failing CI row', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db);
    github.setCiChecks(repository.githubFullName, pr.headSha, [
      { name: 'build', source: 'check_run', state: 'failed' },
    ]);

    const response = await merge(pr, { typedNumber: pr.number, signedBy: kasia.id });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toEqual({
      code: 'merge_not_ready',
      params: {
        items: [
          {
            item: 'ci_green',
            reason: {
              code: 'checklist_ci_failing',
              params: { failed: 1, total: 1, names: ['build'] },
            },
          },
        ],
      },
    });
    expect(github.callsOf('squashMerge')).toEqual([]);
    // The fresh CI is stored, so the page shows what the check saw.
    expect((await stored(pr)).ciChecks).toEqual([{ name: 'build', conclusion: 'failure' }]);
  });

  test('a changes request on fresh state is 409 with that row', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db);
    github.addReview(repository.githubFullName, pr.number, 'tomek', 'CHANGES_REQUESTED');

    const response = await merge(pr, { typedNumber: pr.number, signedBy: kasia.id });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.params.items).toEqual([
      {
        item: 'no_changes_requested',
        reason: { code: 'checklist_changes_requested', params: { by: ['tomek'] } },
      },
    ]);
  });

  test('a green PR squash-merges at the reviewed SHA with the trailer and is merged', async () => {
    const pr = await readyPr({ body: 'Adds edge labels.' });
    const kasia = await seedTeamMember(db, { name: 'Kasia' });

    const response = await merge(pr, { typedNumber: String(pr.number), signedBy: kasia.id });
    expect(response.statusCode).toBe(200);
    const [sent] = github.callsOf('squashMerge')[0] as [Record<string, unknown>];
    expect(sent).toEqual({
      fullName: repository.githubFullName,
      number: pr.number,
      sha: pr.headSha,
      title: `Edge labels (#${pr.number})`,
      message: 'Adds edge labels.\n\nSigned-off-in-app-by: Kasia',
    });
    const mergeSha = github.merges[0]!.mergeSha;
    expect(response.json()).toEqual({
      sha: pr.headSha,
      mergeSha,
      by: { id: kasia.id, name: 'Kasia' },
    });

    const row = await stored(pr);
    expect(row).toMatchObject({ state: 'merged', mergeSha });
    expect(row.mergedAt).not.toBeNull();
    const [entry] = await timeline(pr, 'pr_merged');
    expect(entry).toMatchObject({
      actor: 'member',
      memberId: kasia.id,
      params: { via: 'app', sha: pr.headSha, mergeSha },
    });

    const view = await app.inject({
      method: 'GET',
      url: `/api/prs/${repository.slug}/${pr.number}`,
    });
    expect(view.json().nextStep).toMatchObject({ state: 'merged', lane: null });
  });

  test('GitHub refusal comes back verbatim as 422 and is on the timeline', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db);
    const message = 'Required status check "build" is expected.';
    github.refuseMerge(repository.githubFullName, pr.number, { status: 405, message });

    const response = await merge(pr, { typedNumber: pr.number, signedBy: kasia.id });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toEqual({
      code: 'merge_refused',
      params: { status: 405, message },
    });
    expect((await stored(pr)).state).toBe('open');
    const [entry] = await timeline(pr, 'merge_refused');
    expect(entry).toMatchObject({
      memberId: kasia.id,
      params: { sha: pr.headSha, status: 405, message },
    });
  });

  test('two concurrent merges make one squash merge', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db);

    const responses = await Promise.all([
      merge(pr, { typedNumber: pr.number, signedBy: kasia.id }),
      merge(pr, { typedNumber: pr.number, signedBy: kasia.id }),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(responses.find((r) => r.statusCode === 409)!.json().error.code).toBe('pr_closed');
    expect(github.callsOf('squashMerge')).toHaveLength(1);
  });

  test('a GitHub failure is 502 github_error and leaves the PR open', async () => {
    const pr = await readyPr();
    const kasia = await seedTeamMember(db);
    github.failNext('squashMerge', Object.assign(new Error('boom'), { status: 500 }));

    const response = await merge(pr, { typedNumber: pr.number, signedBy: kasia.id });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toEqual({ code: 'github_error', params: { status: 500 } });
    expect((await stored(pr)).state).toBe('open');
  });
});
