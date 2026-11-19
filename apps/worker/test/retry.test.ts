// S-09-T1: Retry from the failed stage. Stages the failed run finished are reused (no agent or
// sandbox call), the failed stage and those after it run again under the same round number, and
// the failed attempt keeps its cost and never counts toward the chain.
import { chainState, HAND } from '@pra/core';
import {
  asc,
  eq,
  getRun,
  insertFindings,
  insertRun,
  insertStageExecution,
  retryRun,
  roundsOf,
  runRecord,
  schema,
  setForcedChangeType,
  stageExecutionsOfRun,
  upsertPullRequest,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aRun } from '@pra/db/testing';
import { CliGitMirror } from '@pra/integrations';
import { createGitFixture, isolatedGitExec, type GitFixture } from '@pra/integrations/testing';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { executeStage } from '../src/run/execute-stage.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  jobsWhere,
  type TestWorkerDeps,
} from './support.ts';

let fixture: GitFixture;
let deps: TestWorkerDeps;

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

const ANSWER = {
  summary: 'Adds inline renaming.',
  risk: 'low',
  findings: [
    {
      severity: 'should',
      title: 'Rename loses focus',
      file: 'README.md',
      line: 1,
      scenario: 'Rename a node, press Enter: focus is lost.',
      suggestion: 'Keep focus on the input.',
    },
  ],
  questions: [],
  notChecked: [],
};

async function aPullRequestRow() {
  const repository = await connectRepository(deps.db);
  deps.github.installations.set(repository.githubFullName, 1);
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { headSha: fixture.headSha, baseSha: fixture.baseSha }),
  );
  return pullRequest;
}

const completedRounds = async (pullRequestId: number) =>
  chainState((await roundsOf(deps.db, pullRequestId)).map(runRecord)).completedRounds;

test('retry from Review reuses Checks, Task and Change type and keeps the round number', async () => {
  const pullRequest = await aPullRequestRow();
  // A forced change type: the Change type stage calls no judge.
  await setForcedChangeType(deps.db, pullRequest.id, 'uses_existing');
  const failed = await insertRun(
    deps.db,
    aRun(pullRequest.id, { levelNumber: 2, headSha: fixture.headSha }),
  );
  for (const stage of ['checks', 'task', 'change_type']) {
    expect(await executeStage(deps, failed.id, stage)).toBe('succeeded');
  }
  deps.agentRunner.enqueue({ fail: 'agent_failed', costUsd: 0.05 });
  expect(await executeStage(deps, failed.id, 'review')).toBe('failed');
  const failedCost = (await getRun(deps.db, failed.id))!.costUsd;
  expect(failedCost).toBe(0.05);
  expect(await completedRounds(pullRequest.id)).toBe(0);

  const sandboxCalls = deps.sandbox.calls.length;
  const judgeCalls = deps.judge.calls.length;
  const agentCalls = deps.agentRunner.calls.length;

  const result = await retryRun(deps, failed.id, HAND);
  if (!result.retried) throw new Error(`not retried: ${result.reason.code}`);
  const retry = result.run;
  expect(result.fromStage).toBe('review');
  expect(retry).toMatchObject({
    status: 'queued',
    retryOf: failed.id,
    roundNo: failed.roundNo,
    chainId: failed.chainId,
    headSha: failed.headSha,
    level: failed.level,
    startedBy: 'hand',
  });
  // Only the failed stage is queued.
  const jobs = await jobsWhere(deps.db, 'run.stage', 'runId', retry.id);
  expect(jobs.map((job) => job.data.stage)).toEqual(['review']);

  // The reused stages point at the failed run's attempts and carry their output.
  const failedStages = await stageExecutionsOfRun(deps.db, failed.id);
  const reused = await stageExecutionsOfRun(deps.db, retry.id);
  expect(reused.map((s) => [s.stage, s.status]).sort()).toEqual([
    ['change_type', 'reused'],
    ['checks', 'reused'],
    ['task', 'reused'],
  ]);
  for (const row of reused) {
    const source = failedStages.find((s) => s.id === row.reusedFromStageId)!;
    expect(source).toMatchObject({ stage: row.stage, status: 'succeeded' });
    expect(row.output).toEqual(source.output);
  }

  // A stage job for a reused stage does nothing.
  expect(await executeStage(deps, retry.id, 'checks')).toBe('not_next');
  deps.agentRunner.enqueue({ output: ANSWER, costUsd: 0.2 });
  expect(await executeStage(deps, retry.id, 'review')).toBe('succeeded');

  expect(deps.sandbox.calls.length).toBe(sandboxCalls);
  expect(deps.judge.calls.length).toBe(judgeCalls);
  expect(deps.agentRunner.calls.slice(agentCalls).map((call) => call.role)).toEqual(['reviewer']);
  expect(await getRun(deps.db, retry.id)).toMatchObject({
    status: 'completed',
    roundNo: 1,
    costUsd: 0.2,
  });
  expect((await getRun(deps.db, failed.id))!).toMatchObject({
    status: 'failed',
    costUsd: failedCost,
  });
  expect(await completedRounds(pullRequest.id)).toBe(1);
});

test('a retry after Review copies its findings and questions to the new run', async () => {
  const pullRequest = await aPullRequestRow();
  const failed = await insertRun(
    deps.db,
    aRun(pullRequest.id, {
      levelNumber: 3,
      headSha: fixture.headSha,
      status: 'failed',
      notChecked: ['the e2e tests'],
    }),
  );
  const finished = { attempt: 1, startedAt: new Date(), finishedAt: new Date() };
  for (const stage of ['checks', 'task', 'change_type', 'review']) {
    await insertStageExecution(deps.db, {
      runId: failed.id,
      stage,
      status: 'succeeded',
      output: { stage },
      ...finished,
    });
  }
  await insertStageExecution(deps.db, {
    runId: failed.id,
    stage: 'verify',
    status: 'failed',
    errorCode: 'stage_timeout',
    ...finished,
  });
  await insertFindings(deps.db, [
    aFinding(failed.id, pullRequest.id, 1, { title: 'First' }),
    aFinding(failed.id, pullRequest.id, 2, { title: 'Second' }),
  ]);
  await deps.db.insert(schema.questions).values({
    runId: failed.id,
    ordinal: 1,
    text: 'Keep the old API?',
    options: ['Yes', 'No'],
  });

  const result = await retryRun(deps, failed.id, HAND);
  if (!result.retried) throw new Error(`not retried: ${result.reason.code}`);
  expect(result.fromStage).toBe('verify');
  const copied = await deps.db
    .select()
    .from(schema.findings)
    .where(eq(schema.findings.runId, result.run.id))
    .orderBy(asc(schema.findings.ordinal));
  expect(copied.map((f) => [f.ordinal, f.title, f.pullRequestId])).toEqual([
    [1, 'First', pullRequest.id],
    [2, 'Second', pullRequest.id],
  ]);
  const questions = await deps.db
    .select()
    .from(schema.questions)
    .where(eq(schema.questions.runId, result.run.id));
  expect(questions.map((q) => q.text)).toEqual(['Keep the old API?']);
  expect(result.run.notChecked).toEqual(['the e2e tests']);
});

test('only a failed run can be retried, and not while the PR is held', async () => {
  const pullRequest = await aPullRequestRow();
  const running: Run = await insertRun(
    deps.db,
    aRun(pullRequest.id, { status: 'running', headSha: fixture.headSha }),
  );
  const refused = await retryRun(deps, running.id, HAND);
  expect(refused).toEqual({
    retried: false,
    reason: { code: 'run_not_failed', params: { status: 'running' } },
  });

  const failed = await insertRun(
    deps.db,
    aRun(pullRequest.id, { status: 'failed', headSha: fixture.headSha }),
  );
  await insertStageExecution(deps.db, {
    runId: failed.id,
    stage: 'review',
    status: 'failed',
    errorCode: 'agent_failed',
  });
  const held = await retryRun(deps, failed.id, HAND);
  expect(held).toEqual({
    retried: false,
    reason: { code: 'run_active', params: { kind: 'round', status: 'running' } },
  });

  expect(await retryRun(deps, 999_999, HAND)).toEqual({
    retried: false,
    reason: { code: 'run_not_found', params: { runId: 999_999 } },
  });
});
