import { afterAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  getRunDetail,
  insertAgentSession,
  insertFindings,
  insertGithubAction,
  insertQuestions,
  insertRun,
  insertStageExecution,
  isUniqueViolation,
} from './index.ts';
import { aFinding, aQuestion, aRun, seedPullRequest, testDatabaseUrl } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

describe('runs', () => {
  test('writes a run with stages, a session and findings, and reads them back', async () => {
    const { pullRequest } = await seedPullRequest(db);

    const { runId, reviewId } = await db.transaction(async (tx) => {
      const run = await insertRun(
        tx,
        aRun(pullRequest.id, { status: 'completed', costUsd: 1.234567, notChecked: ['e2e'] }),
      );
      for (const stage of ['checks', 'task', 'change_type', 'verify']) {
        await insertStageExecution(tx, { runId: run.id, stage, status: 'off' });
      }
      const review = await insertStageExecution(tx, {
        runId: run.id,
        stage: 'review',
        status: 'succeeded',
        output: { dropped: { overLimit: 2 } },
      });
      await insertAgentSession(tx, {
        stageExecutionId: review.id,
        role: 'reviewer',
        model: 'claude-opus-5-5',
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 50,
        cacheWriteTokens: 10,
        costUsd: 1.234567,
        costSource: 'reported',
        turns: 4,
        durationMs: 61_000,
        status: 'succeeded',
        promptBlobKey: `runs/${run.id}/review/prompt.md`,
        transcriptBlobKey: `runs/${run.id}/review/transcript.json`,
      });
      await insertFindings(tx, [
        aFinding(run.id, pullRequest.id, 1, { severity: 'blocking', line: null }),
        aFinding(run.id, pullRequest.id, 2, {
          evidence: [{ file: 'src/a.ts', line: 3, quote: 'x()' }],
        }),
      ]);
      await insertQuestions(tx, [aQuestion(run.id, 1, { options: ['A', 'B', 'C'] })]);
      return { runId: run.id, reviewId: review.id };
    });

    const detail = await getRunDetail(db, runId);

    expect(detail?.run).toMatchObject({
      kind: 'round',
      status: 'completed',
      costUsd: 1.234567,
      notChecked: ['e2e'],
      level: { number: 1, stages: { review: true, verify: false } },
      startedBy: 'bot',
      startedByMemberId: null,
    });
    expect(detail?.stages.map((s) => [s.stage, s.status, s.attempt])).toEqual([
      ['checks', 'off', 1],
      ['task', 'off', 1],
      ['change_type', 'off', 1],
      ['verify', 'off', 1],
      ['review', 'succeeded', 1],
    ]);
    expect(detail?.sessions).toEqual([
      expect.objectContaining({
        stageExecutionId: reviewId,
        costUsd: 1.234567,
        costSource: 'reported',
        transcriptBlobKey: `runs/${runId}/review/transcript.json`,
      }),
    ]);
    expect(detail?.findings).toEqual([
      expect.objectContaining({
        ordinal: 1,
        severity: 'blocking',
        line: null,
        verdict: 'unchecked',
        evidence: [],
        version: 0,
      }),
      expect.objectContaining({
        ordinal: 2,
        evidence: [{ file: 'src/a.ts', line: 3, quote: 'x()' }],
      }),
    ]);
    expect(detail?.questions).toEqual([
      expect.objectContaining({ options: ['A', 'B', 'C'], recommended: 0 }),
    ]);
  });

  test('a second active run for the same PR fails on the unique index', async () => {
    const { pullRequest } = await seedPullRequest(db);
    await insertRun(db, aRun(pullRequest.id, { status: 'running' }));

    const second = insertRun(db, aRun(pullRequest.id, { status: 'queued' }));

    const error = await second.catch((e: unknown) => e);
    expect(isUniqueViolation(error, 'runs_one_active_per_pr')).toBe(true);
  });

  test('finished runs, trials and the analyst do not count as active', async () => {
    const { pullRequest } = await seedPullRequest(db);
    await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));
    await insertRun(db, aRun(pullRequest.id, { status: 'failed' }));
    await insertRun(db, aRun(pullRequest.id, { status: 'running' }));

    await expect(
      insertRun(db, aRun(pullRequest.id, { kind: 'trial', status: 'running' })),
    ).resolves.toBeDefined();
    await expect(
      insertRun(db, aRun(pullRequest.id, { kind: 'analyst', roundNo: null, status: 'queued' })),
    ).resolves.toBeDefined();
  });

  test('a member start needs a member id, and stage attempts are unique', async () => {
    const { pullRequest } = await seedPullRequest(db);

    await expect(insertRun(db, aRun(pullRequest.id, { startedBy: 'member' }))).rejects.toThrow();
    const run = await insertRun(
      db,
      aRun(pullRequest.id, { startedBy: 'member', startedByMemberId: 'm-1', trigger: 'manual' }),
    );
    await insertStageExecution(db, { runId: run.id, stage: 'review', status: 'failed' });
    await insertStageExecution(db, {
      runId: run.id,
      stage: 'review',
      attempt: 2,
      status: 'running',
    });

    const duplicate = await insertStageExecution(db, {
      runId: run.id,
      stage: 'review',
      attempt: 2,
      status: 'running',
    }).catch((e: unknown) => e);
    expect(isUniqueViolation(duplicate, 'stage_executions_run_stage_attempt')).toBe(true);
  });

  test('records a GitHub action with a 64-bit comment id', async () => {
    const { pullRequest } = await seedPullRequest(db);
    const run = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));

    const action = await insertGithubAction(db, {
      pullRequestId: pullRequest.id,
      runId: run.id,
      kind: 'comment',
      body: 'Ready for team member review (round 1)',
      result: 'posted',
      githubId: 3_456_789_012,
    });

    expect(action).toMatchObject({ githubId: 3_456_789_012, result: 'posted' });
  });
});
