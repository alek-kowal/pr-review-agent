// S-15-T2: level 5 autofix and the shadow log in the worker, with the GitHubGateway double, the real
// `CliGitMirror` pushing to a bare repository per PR, and the run hooks called as the worker calls
// them. Own database: the pause case changes the global status.
import { BOT, DEFAULT_APP_SETTINGS, reason } from '@pra/core';
import {
  autofixAttemptsOfPr,
  currentDecisions,
  eq,
  getPullRequest,
  getRun,
  insertFindings,
  insertRun,
  insertStageExecution,
  recordAutofixAttempt,
  runWaitsOf,
  schema,
  setForcedChangeType,
  shadowOfPr,
  storePatchRevision,
  writeAppSettings,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { CliGitMirror, type GitExec } from '@pra/integrations';
import {
  createGitFixture,
  fixturePullRequest,
  ISOLATED_GIT_ENV,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { autofixOnPatchReady, autofixOnRoundCompleted } from '../src/run/autofix.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { RUN_GATES } from '../src/run/gates.ts';
import { handlePatchPush } from '../src/run/push.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  jobsWhere,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

let database: TestDatabase;
let deps: TestWorkerDeps;
let fixture: GitFixture;
const remotes = new Map<string, string>();
const exec = vi.fn<GitExec>(isolatedGitExec);
let clock = Date.parse('2026-11-19T10:00:00Z');
let nextNumber = 700;

beforeAll(async () => {
  [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
  deps = await createTestWorkerDeps({ url: database.url, extensions: { runGates: RUN_GATES } });
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: (fullName) => remotes.get(fullName)!,
    exec,
  });
}, 30_000);

afterAll(async () => {
  await deps?.close();
  await fixture?.remove();
  await database?.drop();
});

const run = promisify(execFile);
const gitEnv = { ...process.env, ...ISOLATED_GIT_ENV };
const git = async (dir: string, ...args: string[]) =>
  (await run('git', ['-C', dir, ...args], { env: gitEnv })).stdout.trim();
const pushCalls = () => exec.mock.calls.filter(([, args]) => args.includes('push')).length;

async function deliver(
  repository: Repository,
  number: number,
  name: 'ready_for_review' | 'synchronize',
  sha: string,
) {
  clock += 60_000;
  const event = await storeGithubEvent(deps, `pull_request.${name}`, {
    fullName: repository.githubFullName,
    headSha: sha,
    pullRequest: { number, updated_at: new Date(clock).toISOString() },
    payload: { number },
  });
  return processGithubEvent(deps, event.id);
}

const SENSITIVE = [{ pattern: 'CLAUDE.md', reason: 'Instructions agents follow.' }];

/**
 * A PR at `level` whose round 1 completed with two confirmed findings that have an obvious fix,
 * nobody decided yet. Its branch lives in a bare remote.
 */
async function reviewedPr(level: 4 | 5) {
  const repository = await connectRepository(deps.db, {
    defaultLevel: level,
    sensitivePatterns: SENSITIVE,
  });
  const number = nextNumber++;
  // The webhook fixture's head branch; each PR has its own repository and bare remote.
  const branch = 'feature/edge-labels';
  const bare = path.join(deps.dataDir, `remote-${repository.id}.git`);
  await run('git', ['clone', '--quiet', '--bare', fixture.dir, bare], { env: gitEnv });
  // The fixture's `feature` branch would clash with `feature/edge-labels` (a ref can't be both).
  await git(bare, 'update-ref', '-d', 'refs/heads/feature');
  await git(bare, 'update-ref', `refs/heads/${branch}`, fixture.headSha);
  remotes.set(repository.githubFullName, bare);
  deps.github.addPullRequest({
    ...fixturePullRequest('pull_request.opened'),
    fullName: repository.githubFullName,
    number,
    headSha: fixture.headSha,
    headRef: branch,
    isFork: false,
  });
  expect(await deliver(repository, number, 'ready_for_review', fixture.headSha)).toBe(
    'round_started',
  );
  const pullRequest = (await getPullRequest(deps.db, repository.id, number))!;
  const [round] = await deps.db
    .update(schema.runs)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(eq(schema.runs.pullRequestId, pullRequest.id))
    .returning();
  const findings = await insertFindings(deps.db, [
    aFinding(round!.id, pullRequest.id, 1, { verdict: 'confirmed' }),
    aFinding(round!.id, pullRequest.id, 2, { verdict: 'confirmed', severity: 'blocking' }),
  ]);
  await deps.db.insert(schema.findingVerifications).values(
    findings.map((f) => ({
      findingId: f.id,
      runId: round!.id,
      verdict: 'confirmed' as const,
      reason: { code: 'reproduced', params: {} },
      remedy: { kind: 'obvious' as const, why: 'One line.' },
    })),
  );
  return { repository, pullRequest, round: round!, findings, bare, branch, number };
}

type Reviewed = Awaited<ReturnType<typeof reviewedPr>>;

const hookContext = (pr: Reviewed, target: Run, pullRequest: PullRequest = pr.pullRequest) => ({
  deps,
  run: target,
  pullRequest,
  repository: pr.repository,
});

async function runsOf(pullRequestId: number): Promise<Run[]> {
  return deps.db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.pullRequestId, pullRequestId))
    .orderBy(schema.runs.id);
}

/** Completes the bot's implementer run with a patch writing `file`, as the worker would. */
async function completeImplementer(pr: Reviewed, implementer: Run, file: string) {
  const [done] = await deps.db
    .update(schema.runs)
    .set({ status: 'completed', finishedAt: new Date() })
    .where(eq(schema.runs.id, implementer.id))
    .returning();
  const blobKey = `patches/autofix-${implementer.id}/${file}`;
  await deps.blobStore.put(blobKey, Buffer.from('export const fixed = true;\n'), {
    contentType: 'text/plain',
  });
  const ids = pr.findings.map((f) => f.id);
  const { patch } = await storePatchRevision(deps.db, {
    pullRequestId: pr.pullRequest.id,
    runId: implementer.id,
    baseSha: fixture.headSha,
    findingIds: ids,
    fixedFindingIds: ids,
    reproductions: Object.fromEntries(ids.map((id) => [String(id), 'pass' as const])),
    summary: 'Fixed both',
    reviseNote: null,
    startedBy: BOT,
    files: [{ path: file, baseBlobKey: null, blobKey }],
  });
  return { implementer: done!, patch };
}

describe('autofix at level 5', () => {
  test('two confirmed findings: one bot implementer run, one push, then the fix check', async () => {
    const pr = await reviewedPr(5);
    await autofixOnRoundCompleted(hookContext(pr, pr.round));

    const implementers = (await runsOf(pr.pullRequest.id)).filter((r) => r.kind === 'implementer');
    expect(implementers).toEqual([
      expect.objectContaining({ trigger: 'autofix', startedBy: 'bot', status: 'queued' }),
    ]);
    const decisions = await currentDecisions(
      deps.db,
      pr.findings.map((f) => f.id),
    );
    expect([...decisions.values()].map((d) => [d.decision, d.signedBy, d.signerName])).toEqual([
      ['implement', null, 'pr-review-agent'],
      ['implement', null, 'pr-review-agent'],
    ]);

    const before = pushCalls();
    const { implementer, patch } = await completeImplementer(pr, implementers[0]!, 'src/fixed.ts');
    await autofixOnPatchReady(hookContext(pr, implementer));
    const jobs = await jobsWhere(deps.db, 'patch.push', 'patchId', patch.id);
    expect(jobs.map((j) => j.data)).toEqual([{ patchId: patch.id, signedBy: null }]);

    const outcome = await handlePatchPush(deps, { patchId: patch.id, signedBy: null });
    expect(outcome.pushed).toBe(true);
    expect(pushCalls() - before).toBe(1);
    const sha = outcome.pushed ? outcome.sha : '';
    expect(await git(pr.bare, 'rev-parse', `refs/heads/${pr.branch}`)).toBe(sha);
    expect(await git(pr.bare, 'log', '-1', '--format=%B', sha)).not.toContain('Co-authored-by');

    expect(await deliver(pr.repository, pr.number, 'synchronize', sha)).toBe('round_started');
    expect((await runsOf(pr.pullRequest.id)).at(-1)).toMatchObject({
      kind: 'round',
      roundNo: 2,
      trigger: 'own_fix',
      chainId: pr.round.chainId,
      headSha: sha,
    });
    const attempts = await autofixAttemptsOfPr(deps.db, pr.pullRequest.id);
    expect(attempts.map((a) => [a.point, a.outcome, a.sha])).toEqual([
      ['start', 'started', null],
      ['push', 'pushed', sha],
    ]);
  });

  test('a patch that touches a sensitive file pushes nothing and waits with that reason', async () => {
    const pr = await reviewedPr(5);
    await autofixOnRoundCompleted(hookContext(pr, pr.round));
    const [queued] = (await runsOf(pr.pullRequest.id)).filter((r) => r.kind === 'implementer');
    const before = pushCalls();

    const { implementer, patch } = await completeImplementer(pr, queued!, 'CLAUDE.md');
    await autofixOnPatchReady(hookContext(pr, implementer));

    expect(await jobsWhere(deps.db, 'patch.push', 'patchId', patch.id)).toEqual([]);
    expect(pushCalls() - before).toBe(0);
    const attempts = await autofixAttemptsOfPr(deps.db, pr.pullRequest.id);
    expect(attempts.at(-1)).toMatchObject({
      point: 'push',
      outcome: 'waiting',
      patchId: patch.id,
      reasons: [reason('patch_touches_sensitive', { path: 'CLAUDE.md', pattern: 'CLAUDE.md' })],
    });
  });

  test('a third automatic patch in one chain is not started', async () => {
    const pr = await reviewedPr(5);
    for (let i = 0; i < 2; i++) {
      const earlier = await insertRun(
        deps.db,
        aRun(pr.pullRequest.id, {
          kind: 'implementer',
          roundNo: null,
          chainId: null,
          status: 'completed',
          trigger: 'autofix',
          levelNumber: 5,
        }),
      );
      await recordAutofixAttempt(deps.db, {
        pullRequestId: pr.pullRequest.id,
        chainId: pr.round.chainId,
        implementerRunId: earlier.id,
        point: 'start',
        outcome: 'started',
        reasons: [reason('autofix_conditions_met', { count: 2 })],
      });
    }
    const runs = (await runsOf(pr.pullRequest.id)).length;

    await autofixOnRoundCompleted(hookContext(pr, pr.round));

    expect(await runsOf(pr.pullRequest.id)).toHaveLength(runs);
    expect((await autofixAttemptsOfPr(deps.db, pr.pullRequest.id)).at(-1)).toMatchObject({
      point: 'start',
      outcome: 'waiting',
      roundRunId: pr.round.id,
      reasons: [reason('auto_patches_used', { used: 2, max: 2 })],
    });
  });

  test('while the agent is paused, the autofix implementer run is queued with the pause reason', async () => {
    const pr = await reviewedPr(5);
    await writeAppSettings(deps.db, {
      ...DEFAULT_APP_SETTINGS,
      paused: true,
      pausedReason: 'release freeze',
    });
    try {
      await autofixOnRoundCompleted(hookContext(pr, pr.round));
      const [implementer] = (await runsOf(pr.pullRequest.id)).filter(
        (r) => r.kind === 'implementer',
      );
      expect(implementer).toMatchObject({ trigger: 'autofix', status: 'queued' });

      expect(await executeStage(deps, implementer!.id, 'worktree')).toBe('waiting');
      expect((await getRun(deps.db, implementer!.id))?.status).toBe('queued');
      expect((await runWaitsOf(deps.db, [implementer!.id])).get(implementer!.id)?.reason).toEqual(
        expect.objectContaining({ code: 'paused' }),
      );
    } finally {
      await writeAppSettings(deps.db, DEFAULT_APP_SETTINGS);
    }
  });

  test('a PR lowered below level 5 after its round started gets the shadow, not a run', async () => {
    const pr = await reviewedPr(5);
    await deps.db
      .update(schema.pullRequests)
      .set({ level: 4 })
      .where(eq(schema.pullRequests.id, pr.pullRequest.id));

    await autofixOnRoundCompleted(hookContext(pr, pr.round));

    expect((await runsOf(pr.pullRequest.id)).map((r) => r.kind)).toEqual(['round']);
    expect(await autofixAttemptsOfPr(deps.db, pr.pullRequest.id)).toEqual([]);
    expect(await shadowOfPr(deps.db, pr.pullRequest.id)).toEqual([
      expect.objectContaining({ point: 'start', decision: 'would_start', level: 4 }),
    ]);
  });

  test("a person's edit, or a lowered level, before the push job stops the bot's push", async () => {
    const pr = await reviewedPr(5);
    await autofixOnRoundCompleted(hookContext(pr, pr.round));
    const [queued] = (await runsOf(pr.pullRequest.id)).filter((r) => r.kind === 'implementer');
    const { implementer, patch } = await completeImplementer(pr, queued!, 'src/edited.ts');
    await autofixOnPatchReady(hookContext(pr, implementer));
    expect(await jobsWhere(deps.db, 'patch.push', 'patchId', patch.id)).toHaveLength(1);
    const before = pushCalls();

    // A person edits a file meanwhile: the patch check runs its reproductions again.
    await deps.db
      .update(schema.patches)
      .set({ checking: true })
      .where(eq(schema.patches.id, patch.id));
    expect(await handlePatchPush(deps, { patchId: patch.id, signedBy: null })).toEqual({
      pushed: false,
      reason: reason('autofix_patch_edited'),
    });

    await deps.db
      .update(schema.patches)
      .set({ checking: false })
      .where(eq(schema.patches.id, patch.id));
    await deps.db
      .update(schema.pullRequests)
      .set({ level: 4 })
      .where(eq(schema.pullRequests.id, pr.pullRequest.id));
    expect(await handlePatchPush(deps, { patchId: patch.id, signedBy: null })).toEqual({
      pushed: false,
      reason: reason('autofix_level_lowered', { level: 4 }),
    });
    expect(pushCalls() - before).toBe(0);
    expect(await git(pr.bare, 'rev-parse', `refs/heads/${pr.branch}`)).toBe(fixture.headSha);
  });

  test("a person's forced One-way door holds autofix over the round's own change type", async () => {
    const pr = await reviewedPr(5);
    await insertStageExecution(deps.db, {
      runId: pr.round.id,
      stage: 'change_type',
      status: 'succeeded',
      output: { changeType: 'changes_behaviour' },
    });
    await setForcedChangeType(deps.db, pr.pullRequest.id, 'one_way_door');

    await autofixOnRoundCompleted(hookContext(pr, pr.round));

    const kinds = (await runsOf(pr.pullRequest.id)).map((r) => r.kind);
    expect(kinds).not.toContain('implementer');
    expect((await autofixAttemptsOfPr(deps.db, pr.pullRequest.id)).at(-1)).toMatchObject({
      point: 'start',
      outcome: 'waiting',
      reasons: [reason('one_way_door_hold')],
    });
  });

  test('a pause after the autofix run started pushes nothing, at patch ready or in the job', async () => {
    const pr = await reviewedPr(5);
    await autofixOnRoundCompleted(hookContext(pr, pr.round));
    const [queued] = (await runsOf(pr.pullRequest.id)).filter((r) => r.kind === 'implementer');
    const { implementer, patch } = await completeImplementer(pr, queued!, 'src/paused.ts');
    const before = pushCalls();
    await writeAppSettings(deps.db, {
      ...DEFAULT_APP_SETTINGS,
      paused: true,
      pausedReason: 'release freeze',
    });
    try {
      await autofixOnPatchReady(hookContext(pr, implementer));
      expect(await jobsWhere(deps.db, 'patch.push', 'patchId', patch.id)).toEqual([]);
      expect((await autofixAttemptsOfPr(deps.db, pr.pullRequest.id)).at(-1)).toMatchObject({
        point: 'push',
        outcome: 'waiting',
        reasons: [reason('autofix_paused')],
      });

      // A push job queued before the pause checks it again.
      const outcome = await handlePatchPush(deps, { patchId: patch.id, signedBy: null });
      expect(outcome).toEqual({ pushed: false, reason: reason('autofix_paused') });
      expect(pushCalls() - before).toBe(0);
      expect(await git(pr.bare, 'rev-parse', `refs/heads/${pr.branch}`)).toBe(fixture.headSha);
    } finally {
      await writeAppSettings(deps.db, DEFAULT_APP_SETTINGS);
    }
  });
});

describe('the shadow below level 5', () => {
  test('a level 4 round starts no implementer run and writes one shadow entry', async () => {
    const pr = await reviewedPr(4);
    await autofixOnRoundCompleted(hookContext(pr, pr.round));
    await autofixOnRoundCompleted(hookContext(pr, pr.round));

    expect((await runsOf(pr.pullRequest.id)).map((r) => r.kind)).toEqual(['round']);
    expect(await autofixAttemptsOfPr(deps.db, pr.pullRequest.id)).toEqual([]);
    expect(await shadowOfPr(deps.db, pr.pullRequest.id)).toEqual([
      expect.objectContaining({
        point: 'start',
        decision: 'would_start',
        level: 4,
        fixed: 2,
        total: 2,
        runId: pr.round.id,
      }),
    ]);
    expect(await currentDecisions(deps.db, [pr.findings[0]!.id])).toEqual(new Map());
  });

  /** A person's implementer run at level 4, completed with a passing patch. */
  async function personsPatch(pr: Reviewed, file: string) {
    const implementer = await insertRun(
      deps.db,
      aRun(pr.pullRequest.id, {
        kind: 'implementer',
        roundNo: null,
        chainId: null,
        status: 'running',
        trigger: 'manual',
        levelNumber: 4,
        headSha: fixture.headSha,
      }),
    );
    return completeImplementer(pr, implementer, file);
  }

  test("a person's passing patch writes would_push when level 5 would have started", async () => {
    const pr = await reviewedPr(4);
    await autofixOnRoundCompleted(hookContext(pr, pr.round));
    const { implementer, patch } = await personsPatch(pr, 'src/shadow.ts');

    await autofixOnPatchReady(hookContext(pr, implementer));

    expect(await jobsWhere(deps.db, 'patch.push', 'patchId', patch.id)).toEqual([]);
    expect((await shadowOfPr(deps.db, pr.pullRequest.id)).at(-1)).toMatchObject({
      point: 'push',
      decision: 'would_push',
      patchId: patch.id,
    });
  });

  test('a passing patch after a held start stays would_wait with the start reason', async () => {
    const pr = await reviewedPr(4);
    await setForcedChangeType(deps.db, pr.pullRequest.id, 'one_way_door');
    await autofixOnRoundCompleted(hookContext(pr, pr.round));
    const { implementer, patch } = await personsPatch(pr, 'src/held.ts');

    await autofixOnPatchReady(hookContext(pr, implementer));

    expect((await shadowOfPr(deps.db, pr.pullRequest.id)).map((e) => e.decision)).toEqual([
      'would_wait',
      'would_wait',
    ]);
    expect((await shadowOfPr(deps.db, pr.pullRequest.id)).at(-1)).toMatchObject({
      point: 'push',
      patchId: patch.id,
      reasons: [reason('one_way_door_hold')],
    });
  });
});
