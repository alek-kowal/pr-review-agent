// S-14-T2: the push job with a GitHubGateway double and the real `CliGitMirror`, pushing to a
// bare repository per test. Then the `synchronize` of the pushed commit starts the fix check.
import { BOT, member } from '@pra/core';
import {
  eq,
  getPatch,
  getPullRequest,
  insertRun,
  schema,
  storePatchRevision,
  timelineOf,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aRun, seedTeamMember } from '@pra/db/testing';
import { CliGitMirror, type GitExec } from '@pra/integrations';
import {
  createGitFixture,
  fixturePullRequest,
  ISOLATED_GIT_ENV,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { handlePatchPush } from '../src/run/push.ts';
import { connectRepository, createTestWorkerDeps, storeGithubEvent } from './support.ts';

const deps = await createTestWorkerDeps();
const BRANCH = 'feature/edge-labels';
const NUMBER = 312;
let fixture: GitFixture;
let signer: { id: string; name: string };
const remotes = new Map<string, string>();
const exec = vi.fn<GitExec>(isolatedGitExec);
let clock = Date.parse('2026-11-19T10:00:00Z');

beforeAll(async () => {
  fixture = await createGitFixture();
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: (fullName) => remotes.get(fullName)!,
    exec,
  });
  signer = await seedTeamMember(deps.db, { name: 'Kasia', githubLogin: 'kasia-p22' });
  deps.github.addUser('kasia-p22', 7);
}, 30_000);

afterAll(async () => {
  await deps.close();
  await fixture.remove();
});

const run = promisify(execFile);
const gitEnv = { ...process.env, ...ISOLATED_GIT_ENV };
const git = async (dir: string, ...args: string[]) =>
  (await run('git', ['-C', dir, ...args], { env: gitEnv })).stdout.trim();

async function deliver(
  repository: Repository,
  name: 'ready_for_review' | 'synchronize',
  sha: string,
) {
  clock += 60_000;
  const event = await storeGithubEvent(deps, `pull_request.${name}`, {
    fullName: repository.githubFullName,
    headSha: sha,
    pullRequest: { updated_at: new Date(clock).toISOString() },
  });
  return processGithubEvent(deps, event.id);
}

const pushCalls = () => exec.mock.calls.filter(([, args]) => args.includes('push')).length;

/** A reviewed PR (round 1 completed) with a ready patch adding one file, and its bare remote. */
async function readyPatch() {
  const repository = await connectRepository(deps.db);
  const bare = path.join(deps.dataDir, `remote-${repository.id}.git`);
  await run('git', ['clone', '--quiet', '--bare', fixture.dir, bare], { env: gitEnv });
  // The fixture's `feature` branch would clash with `feature/edge-labels` (a ref can't be both).
  await git(bare, 'update-ref', '-d', 'refs/heads/feature');
  await git(bare, 'update-ref', `refs/heads/${BRANCH}`, fixture.headSha);
  remotes.set(repository.githubFullName, bare);
  deps.github.addPullRequest({
    ...fixturePullRequest('pull_request.opened'),
    fullName: repository.githubFullName,
    number: NUMBER,
    headSha: fixture.headSha,
    headRef: BRANCH,
    isFork: false,
  });
  await deliver(repository, 'ready_for_review', fixture.headSha);
  const pullRequest = (await getPullRequest(deps.db, repository.id, NUMBER))!;
  const [round] = await deps.db
    .update(schema.runs)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(eq(schema.runs.pullRequestId, pullRequest.id))
    .returning();
  const implementer = await insertRun(
    deps.db,
    aRun(pullRequest.id, {
      kind: 'implementer',
      roundNo: null,
      chainId: null,
      status: 'completed',
      trigger: 'manual',
      headSha: fixture.headSha,
    }),
  );
  const blobKey = `patches/test-${repository.id}/fixed.ts`;
  await deps.blobStore.put(blobKey, Buffer.from('export const fixed = true;\n'), {
    contentType: 'text/plain',
  });
  const { patch } = await storePatchRevision(deps.db, {
    pullRequestId: pullRequest.id,
    runId: implementer.id,
    baseSha: fixture.headSha,
    findingIds: [1, 2],
    fixedFindingIds: [1, 2],
    reproductions: {},
    summary: 'Fixed both',
    reviseNote: null,
    startedBy: member(signer.id),
    files: [{ path: 'src/fixed.ts', baseBlobKey: null, blobKey }],
  });
  return { repository, pullRequest, round: round!, patch, bare };
}

async function runsOf(pullRequest: PullRequest): Promise<Run[]> {
  return deps.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.pullRequestId, pullRequest.id))
    .orderBy(schema.runs.id);
}

describe('push job', () => {
  test('a ready patch is pushed once even when the job is delivered twice', async () => {
    const { pullRequest, patch, bare } = await readyPatch();
    const before = pushCalls();

    const first = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });
    const second = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });

    expect(first).toEqual({ pushed: true, sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(second).toEqual({ pushed: false, reason: 'not_ready' });
    expect(pushCalls() - before).toBe(1);
    const sha = first.pushed ? first.sha : '';
    expect(await git(bare, 'rev-parse', `refs/heads/${BRANCH}`)).toBe(sha);
    expect(await git(bare, 'log', '-1', '--format=%an%n%B', sha)).toContain(
      'Co-authored-by: Kasia <7+kasia-p22@users.noreply.github.com>',
    );
    expect(await getPatch(deps.db, patch.id)).toMatchObject({ status: 'pushed', pushedSha: sha });
    const entries = await timelineOf(deps.db, pullRequest.id);
    expect(entries.filter((e) => e.kind === 'patch_pushed')).toEqual([
      expect.objectContaining({
        actor: 'member',
        memberId: signer.id,
        memberName: 'Kasia',
        params: expect.objectContaining({ sha, branch: BRANCH }),
      }),
    ]);
  });

  test('a retry after the commit landed finishes the push instead of refusing it', async () => {
    const { repository, pullRequest, round, patch, bare } = await readyPatch();
    const before = pushCalls();
    vi.spyOn(deps.db, 'transaction').mockRejectedValueOnce(new Error('connection lost'));

    await expect(handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id })).rejects.toThrow(
      'connection lost',
    );
    const landed = await git(bare, 'rev-parse', `refs/heads/${BRANCH}`);
    expect(landed).not.toBe(fixture.headSha);
    deps.github.addPullRequest({
      ...deps.github.pullRequests.get(`${repository.githubFullName}#${NUMBER}`)!,
      headSha: landed,
    });
    deps.github.setComparison(repository.githubFullName, fixture.headSha, landed, 1);
    expect(await deliver(repository, 'synchronize', landed)).toBe('push_never_starts');

    const retry = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });

    expect(retry).toEqual({ pushed: true, sha: landed });
    expect(pushCalls() - before).toBe(1);
    expect(await getPatch(deps.db, patch.id)).toMatchObject({
      status: 'pushed',
      pushedSha: landed,
      pushRefusal: null,
    });
    const kinds = (await timelineOf(deps.db, pullRequest.id)).map((entry) => entry.kind);
    expect(kinds).toContain('patch_pushed');
    expect(kinds).not.toContain('patch_push_refused');
    const fix = (await runsOf(pullRequest)).find((run) => run.trigger === 'own_fix');
    expect(fix).toMatchObject({ roundNo: 2, chainId: round.chainId, headSha: landed });
  });

  test('a redelivery after the patch was marked pushed repeats the hand-off', async () => {
    const { repository, pullRequest, round, patch } = await readyPatch();
    const first = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });
    const sha = first.pushed ? first.sha : '';
    // The first delivery stopped before its hand-off: the chain expects nothing yet.
    await deps.db
      .update(schema.roundChains)
      .set({ expectedHeadSha: null })
      .where(eq(schema.roundChains.id, round.chainId!));
    deps.github.setComparison(repository.githubFullName, fixture.headSha, sha, 1);
    expect(await deliver(repository, 'synchronize', sha)).toBe('push_never_starts');

    const again = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });

    expect(again).toEqual({ pushed: false, reason: 'not_ready' });
    const fix = (await runsOf(pullRequest)).find((run) => run.trigger === 'own_fix');
    expect(fix).toMatchObject({ roundNo: 2, chainId: round.chainId, headSha: sha });
  });

  test('a moved head records head_moved on the patch and pushes nothing', async () => {
    const { repository, pullRequest, patch, bare } = await readyPatch();
    const moved = 'f'.repeat(40);
    deps.github.addPullRequest({
      ...deps.github.pullRequests.get(`${repository.githubFullName}#${NUMBER}`)!,
      headSha: moved,
    });
    const before = pushCalls();

    const outcome = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });

    expect(outcome).toEqual({
      pushed: false,
      reason: { code: 'head_moved', params: { headSha: moved } },
    });
    expect(pushCalls() - before).toBe(0);
    expect(await git(bare, 'rev-parse', `refs/heads/${BRANCH}`)).toBe(fixture.headSha);
    expect(await getPatch(deps.db, patch.id)).toMatchObject({
      status: 'ready',
      pushRefusal: { code: 'head_moved', params: { headSha: moved } },
    });
    const refused = (await timelineOf(deps.db, pullRequest.id)).filter(
      (entry) => entry.kind === 'patch_push_refused',
    );
    expect(refused).toEqual([
      expect.objectContaining({
        actor: 'member',
        memberId: signer.id,
        params: {
          reason: { code: 'head_moved', params: { headSha: moved } },
          patchId: patch.id,
        },
      }),
    ]);
  });

  test('a push GitHub declines is recorded as push_rejected, not lost', async () => {
    const { pullRequest, patch, bare } = await readyPatch();
    await writeFile(path.join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });

    const outcome = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });

    expect(outcome).toEqual({ pushed: false, reason: { code: 'push_rejected', params: {} } });
    expect(await getPatch(deps.db, patch.id)).toMatchObject({
      status: 'ready',
      pushRefusal: { code: 'push_rejected' },
    });
    const refused = (await timelineOf(deps.db, pullRequest.id)).filter(
      (entry) => entry.kind === 'patch_push_refused',
    );
    expect(refused).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ patchId: patch.id }) }),
    ]);
  });

  test('the synchronize of the pushed commit starts round 2 of 3 as a fix check', async () => {
    const { repository, pullRequest, round, patch } = await readyPatch();
    const outcome = await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });
    const sha = outcome.pushed ? outcome.sha : '';

    expect(await deliver(repository, 'synchronize', sha)).toBe('round_started');

    const fix = (await runsOf(pullRequest)).find((run) => run.trigger === 'own_fix');
    expect(fix).toMatchObject({
      kind: 'round',
      roundNo: 2,
      chainId: round.chainId,
      headSha: sha,
      startedBy: BOT.kind,
    });
  });

  test("a person's commit on top of the pushed commit starts nothing", async () => {
    const { repository, pullRequest, patch } = await readyPatch();
    await handlePatchPush(deps, { patchId: patch.id, signedBy: signer.id });
    const runs = (await runsOf(pullRequest)).length;
    deps.github.setComparison(repository.githubFullName, fixture.headSha, 'e'.repeat(40), 2);

    expect(await deliver(repository, 'synchronize', 'e'.repeat(40))).toBe('push_never_starts');
    expect(await runsOf(pullRequest)).toHaveLength(runs);
  });
});
