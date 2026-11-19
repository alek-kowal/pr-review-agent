// P-26: `pnpm judge:compare`: arguments, the stored samples (read-only), the comparison maths.
import { judgeRequest, OpenRouterJudge, type JudgeInput } from '@pra/agents';
import { FakeJudge } from '@pra/agents/testing';
import type { ChangeType } from '@pra/core';
import {
  insertAgentSession,
  insertRun,
  insertStageExecution,
  judgeSamples,
  readOnly,
  schema,
  setForcedChangeType,
  upsertPullRequest,
} from '@pra/db';
import { aPullRequest, aRun } from '@pra/db/testing';
import { FakeOpenRouterClient, openRouterChat } from '@pra/integrations/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  formatReport,
  parseCompareArgs,
  planText,
  runComparison,
  summarize,
  type LoadedSample,
} from '../src/judge-compare/compare.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

const JEV = 'openrouter/typesafe/jev-router';
let deps: TestWorkerDeps;

beforeAll(async () => {
  deps = await createTestWorkerDeps();
});
afterAll(async () => {
  await deps.close();
});

describe('judge:compare arguments', () => {
  test('reads models, limit and --yes; refuses what is not a judge model', () => {
    expect(parseCompareArgs(['--models', `claude-haiku-5-5, ${JEV}`, '--limit', '5'])).toEqual({
      ok: true,
      args: { models: ['claude-haiku-5-5', JEV], limit: 5, yes: false },
    });
    expect(parseCompareArgs(['--models', 'claude-haiku-5-5', '--yes'])).toMatchObject({
      ok: true,
      args: { limit: 20, yes: true },
    });
    expect(parseCompareArgs([])).toMatchObject({ ok: false });
    expect(parseCompareArgs(['--models', 'a b'])).toMatchObject({ ok: false });
    expect(parseCompareArgs(['--models', 'claude-haiku-5-5', '--limit', '0'])).toMatchObject({
      ok: false,
    });
    expect(parseCompareArgs(['--models', 'x', '--bogus'])).toMatchObject({ ok: false });
  });
});

describe('stored judge samples', () => {
  /** A PR whose change-type stage stored one judge session; optionally a forced type. */
  async function storedJudgeCall(prNumber: number, forced: ChangeType | null) {
    const repository = await connectRepository(deps.db);
    const { pullRequest } = await upsertPullRequest(
      deps.db,
      aPullRequest(repository.id, { number: prNumber }),
    );
    if (forced) await setForcedChangeType(deps.db, pullRequest.id, forced);
    const run = await insertRun(deps.db, aRun(pullRequest.id, { levelNumber: 2 }));
    const stage = await insertStageExecution(deps.db, {
      runId: run.id,
      stage: 'change_type',
      status: 'succeeded',
      output: { rules: { changeType: 'uses_existing' } },
    });
    await insertAgentSession(deps.db, {
      stageExecutionId: stage.id,
      role: 'judge',
      model: 'claude-haiku-5-5',
      costUsd: 0.001,
      costSource: 'reported',
      status: 'completed',
      promptBlobKey: `prompts/${prNumber}.txt`,
    });
    return pullRequest.id;
  }

  test('lists PRs with a forced type first, reads only, and plans the call count', async () => {
    const plain = await storedJudgeCall(9101, null);
    const forced = await storedJudgeCall(9102, 'one_way_door');

    const samples = await readOnly(deps.db, (tx) => judgeSamples(tx, { limit: 100 }));
    const ours = samples.filter((s) => [plain, forced].includes(s.pullRequestId));
    expect(ours.map((s) => [s.pullRequestId, s.forced, s.floor])).toEqual([
      [forced, 'one_way_door', 'uses_existing'],
      [plain, null, 'uses_existing'],
    ]);
    expect(planText(ours, ['a', 'b'])).toBe(
      '2 stored PRs with a judge call (1 with a forced type) × 2 models = 4 judge calls.\n',
    );

    // The transaction is read-only: a write fails.
    await expect(
      readOnly(deps.db, (tx) => tx.update(schema.pullRequests).set({ title: 'x' })),
    ).rejects.toThrow();
  });
});

describe('the comparison', () => {
  const message: Omit<JudgeInput, 'model'> = {
    instructions: { prompt: 'Classify.', rules: '# Rules' },
    task: 'Add a retry button.',
    changedFiles: ['a.ts'],
  };
  const sample = (id: number, forced: ChangeType | null): LoadedSample => ({
    pullRequestId: id,
    repository: 'acme/app',
    prNumber: id,
    forced,
    floor: 'uses_existing',
    model: 'claude-haiku-5-5',
    promptBlobKey: `k${id}`,
    message,
  });

  test('scores each model against forced types, with agreement, cost and routed models', async () => {
    const samples = [sample(1, 'changes_behaviour'), sample(2, 'one_way_door'), sample(3, null)];
    const claude = new FakeJudge([
      { changeType: 'changes_behaviour', reason: 'r', costUsd: 0.002 },
      { changeType: 'changes_behaviour', reason: 'r', costUsd: 0.002 },
      { changeType: 'uses_existing', reason: 'r', costUsd: 0.002 },
    ]);
    const client = new FakeOpenRouterClient(
      openRouterChat({ tier: 'extends', reason: 'r' }, { model: 'acme/small' }),
      openRouterChat({ tier: 'one-way', reason: 'r' }, { model: 'acme/large' }),
      openRouterChat('not json'),
    );
    const openRouter = new OpenRouterJudge({ client });
    const calls = await runComparison({
      samples,
      models: ['claude-haiku-5-5', JEV],
      judgeFor: (model) => (model === JEV ? openRouter : claude),
    });

    // The replay sends the stored message, with no fallback.
    expect(client.requests[0]!.messages[0]!.content).toBe(
      judgeRequest({ ...message, model: JEV }).messages[0]!.content,
    );
    const summary = summarize(samples, ['claude-haiku-5-5', JEV], calls);
    expect(summary.models).toEqual([
      expect.objectContaining({
        model: 'claude-haiku-5-5',
        completed: 3,
        scored: 2,
        correct: 1,
        accuracy: 0.5,
        costUsd: expect.closeTo(0.006, 6),
      }),
      expect.objectContaining({
        model: JEV,
        completed: 2,
        scored: 2,
        correct: 2,
        accuracy: 1,
        answeredBy: { 'acme/small': 1, 'acme/large': 1 },
        errors: { output_invalid: 1 },
        costUsd: expect.closeTo(0.00126, 6),
      }),
    ]);
    expect(summary.agreement).toEqual([
      { a: 'claude-haiku-5-5', b: JEV, both: 2, same: 1, rate: 0.5 },
    ]);
    const report = formatReport(summary);
    expect(report).toContain('accuracy    100% (2 of 2 PRs with a forced type)');
    expect(report).toContain(`claude-haiku-5-5 vs ${JEV}: 50% (1 of 2)`);
  });
});
