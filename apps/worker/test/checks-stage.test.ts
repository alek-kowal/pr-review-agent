// S-04-T3: the Checks stage with `FakeGitHubGateway` CI, a `FakeSandbox` and a local git repository.
import { planRun } from '@pra/core';
import {
  and,
  asc,
  eq,
  getRun,
  insertRun,
  schema,
  upsertPullRequest,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aPullRequest, aRun } from '@pra/db/testing';
import { CliGitMirror, IntegrationNotConfiguredError } from '@pra/integrations';
import {
  createGitFixture,
  FakeSandbox,
  isolatedGitExec,
  type GitFixture,
} from '@pra/integrations/testing';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import type { ChecksOutput } from '../src/stages/checks.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  jobsWhere,
  type TestWorkerDeps,
} from './support.ts';

let fixture: GitFixture;
let deps: TestWorkerDeps;
let repository: Repository;
let pullRequest: PullRequest;

beforeAll(async () => {
  fixture = await createGitFixture();
  deps = await createTestWorkerDeps();
  deps.gitMirror = new CliGitMirror({
    rootDir: path.join(deps.dataDir, 'git'),
    remoteUrl: () => fixture.dir,
    exec: isolatedGitExec,
  });
});

afterAll(async () => {
  await deps.close();
  await fixture.remove();
});

beforeEach(async () => {
  repository = await connectRepository(deps.db, {
    fetchCommand: 'pnpm fetch --frozen-lockfile --ignore-scripts',
    installCommand: 'pnpm install --offline --frozen-lockfile',
  });
  ({ pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  ));
  deps.sandbox = new FakeSandbox();
});

const stageRows = (runId: number) =>
  deps.db
    .select()
    .from(schema.stageExecutions)
    .where(eq(schema.stageExecutions.runId, runId))
    .orderBy(asc(schema.stageExecutions.id));

describe('Checks stage', () => {
  test('level 2 runs Checks first, stores CI counts and the install result, then queues Task', async () => {
    deps.github.setCiChecks(repository.githubFullName, fixture.headSha, [
      { name: 'build', source: 'check_run', state: 'passed' },
      { name: 'lint', source: 'check_run', state: 'failed' },
      { name: 'e2e', source: 'status', state: 'pending' },
    ]);
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
    );
    expect(planRun({ kind: 'round', level: 2 }).stages[0]).toMatchObject({
      key: 'checks',
      status: 'pending',
    });

    // Task is not next: the stage job for it does nothing while Checks is pending.
    expect(await executeStage(deps, run.id, 'task')).toBe('not_next');
    expect(await executeStage(deps, run.id, 'checks')).toBe('succeeded');

    const checks = (await stageRows(run.id)).find((row) => row.stage === 'checks')!;
    const output = checks.output as ChecksOutput;
    expect(output.ci).toMatchObject({ passed: 1, failed: 1, pending: 1, total: 3 });
    expect(output.install).toMatchObject({
      status: 'ok',
      failedStep: null,
      install: { exitCode: 0, timedOut: false },
    });
    // Fetch with network, install without, both in the run's worktree.
    expect(deps.sandbox.calls.map((call) => call.network)).toEqual(['egress', 'none']);
    const worktree = deps.sandbox.calls[1]!.mounts[0]!.hostPath;
    expect(await readFile(path.join(worktree, 'apps/demo/src/edges.ts'), 'utf8')).toBeTruthy();
    expect(await deps.blobStore.get(output.install.logBlobKey!)).toBeTruthy();

    const next = await jobsWhere(deps.db, 'run.stage', 'runId', run.id);
    expect(next.map((job) => job.data.stage)).toEqual(['task']);
    expect((await getRun(deps.db, run.id))!.status).toBe('running');
  });

  test('a failed install is a Checks result with its exit code and log tail', async () => {
    deps.sandbox = new FakeSandbox((spec) =>
      spec.network === 'none' ? { exitCode: 1, output: 'ERR_PNPM_NO_OFFLINE_TARBALL lodash' } : {},
    );
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
    );

    expect(await executeStage(deps, run.id, 'checks')).toBe('succeeded');

    const output = (await stageRows(run.id)).find((row) => row.stage === 'checks')!
      .output as ChecksOutput;
    expect(output.install).toMatchObject({
      status: 'failed',
      failedStep: 'install',
      install: { exitCode: 1, outputTail: 'ERR_PNPM_NO_OFFLINE_TARBALL lodash' },
    });
    const log = await deps.blobStore.get(output.install.logBlobKey!);
    expect(new TextDecoder().decode(log!.body)).toContain('ERR_PNPM_NO_OFFLINE_TARBALL');
  });

  test('a repository without an install command skips the install', async () => {
    const plain = await connectRepository(deps.db, { installCommand: null, fetchCommand: null });
    const { pullRequest: pr } = await upsertPullRequest(
      deps.db,
      aPullRequest(plain.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
    );
    const run = await insertRun(deps.db, aRun(pr.id, { levelNumber: 2, headSha: fixture.headSha }));
    const before = deps.sandbox.calls.length;

    expect(await executeStage(deps, run.id, 'checks')).toBe('succeeded');

    const output = (await stageRows(run.id)).find((row) => row.stage === 'checks')!
      .output as ChecksOutput;
    expect(output.install).toMatchObject({ status: 'skipped', logBlobKey: null });
    expect(deps.sandbox.calls.length).toBe(before);
  });

  test('level 1 plans no Checks stage: it is off with its reason', async () => {
    const plan = planRun({ kind: 'round', level: 1 });
    expect(plan.stages.find((s) => s.key === 'checks')).toMatchObject({
      status: 'off',
      offReason: { code: 'off_at_level' },
    });
    deps.agentRunner.enqueue({
      output: { summary: 's', risk: 'low', findings: [], questions: [], notChecked: [] },
    });
    const ciCalls = deps.github.callsOf('getCiStatus').length;
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 1, headSha: fixture.headSha }),
    );

    expect(await executeStage(deps, run.id, 'checks')).toBe('not_next');
    expect(await executeStage(deps, run.id, 'review')).toBe('succeeded');

    const rows = await stageRows(run.id);
    expect(rows.find((row) => row.stage === 'checks')).toMatchObject({ status: 'off' });
    expect(deps.github.callsOf('getCiStatus')).toHaveLength(ciCalls);
  });

  test('a sandbox that is not configured fails the stage with sandbox_not_configured', async () => {
    deps.sandbox = new FakeSandbox(() => {
      throw new IntegrationNotConfiguredError('sandbox_not_configured', ['docker']);
    });
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
    );

    expect(await executeStage(deps, run.id, 'checks')).toBe('failed');

    const [checks] = await deps.db
      .select()
      .from(schema.stageExecutions)
      .where(
        and(eq(schema.stageExecutions.runId, run.id), eq(schema.stageExecutions.stage, 'checks')),
      );
    expect(checks).toMatchObject({ status: 'failed', errorCode: 'sandbox_not_configured' });
    expect((await getRun(deps.db, run.id))!.status).toBe('failed');
  });

  test('a GitHub error fails the stage with github_error and its status', async () => {
    deps.github.failNext('getCiStatus', Object.assign(new Error('Bad Gateway'), { status: 502 }));
    const run = await insertRun(
      deps.db,
      aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
    );

    expect(await executeStage(deps, run.id, 'checks')).toBe('failed');

    const checks = (await stageRows(run.id)).find((row) => row.stage === 'checks')!;
    expect(checks).toMatchObject({ errorCode: 'github_error', errorDetail: '{"status":502}' });
  });
});
