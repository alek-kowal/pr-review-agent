// S-10-T3: pause, daily budget and agent slots enforced before a round starts and before every
// agent stage, and the drainer that starts queued rounds oldest first.
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@pra/core';
import type { AgentRunResult } from '@pra/agents';
import {
  getAppSettings,
  getPullRequest,
  getRun,
  inArray,
  insertAgentSession,
  insertRun,
  insertStageExecution,
  runWaitsOf,
  schema,
  upsertPullRequest,
  writeAppSettings,
  type Repository,
  type Run,
} from '@pra/db';
import { aPullRequest, aRun, createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { queueRoundGate } from '../src/run/budget-gate.ts';
import { drainQueue } from '../src/run/drain.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { RUN_GATES } from '../src/run/gates.ts';
import { STAGE_EXECUTORS } from '../src/stages/index.ts';
import type { StageExecutor } from '../src/stages/stage.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  jobsWhere,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

const SESSION_COST_USD = 0.5;

// Each agent session is held until the test releases it, so a started round keeps its slot.
const held: (() => void)[] = [];
const releaseOldest = () => held.shift()?.();

/** A review stage that runs one session through the `AgentRunner` double. */
const reviewOnce: StageExecutor = {
  key: 'review',
  usesAgent: true,
  async run({ deps, run }) {
    // The step is scripted only once the gates let the stage run, so a wait leaves none behind.
    agentStep();
    const result = await deps.agentRunner.run({
      role: 'reviewer',
      model: 'claude-opus-5-5',
      cwd: '.',
      prompt: `run ${run.id}`,
      outputSchema: undefined as never,
      maxTurns: 1,
      maxCostUsd: 1,
      timeoutMs: 60_000,
    });
    const session = { role: 'reviewer' as const, model: 'claude-opus-5-5', prompt: '', result };
    return {
      status: 'succeeded',
      output: {},
      sessions: [session],
      findings: [],
      questions: [],
      notChecked: [],
    };
  },
};

let database: TestDatabase;
let deps: TestWorkerDeps;
let repository: Repository;
let nextNumber = 500;

beforeAll(async () => {
  database = await createTestDatabase();
  deps = await createTestWorkerDeps({
    url: database.url,
    extensions: {
      runGates: RUN_GATES,
      stageExecutors: { ...STAGE_EXECUTORS, review: reviewOnce },
    },
  });
  repository = await connectRepository(deps.db, { defaultLevel: 1 });
});

afterAll(async () => {
  while (held.length) releaseOldest();
  await deps.close();
  await database.drop();
});

beforeEach(async () => {
  while (held.length) releaseOldest();
  // Each test starts with an empty queue and the default status.
  await deps.db
    .update(schema.runs)
    .set({ status: 'cancelled', finishedAt: new Date() })
    .where(inArray(schema.runs.status, ['queued', 'running']));
  await setStatus({});
  deps.agentRunner.calls.length = 0;
});

function agentStep(): void {
  deps.agentRunner.enqueue(
    () =>
      new Promise<AgentRunResult<unknown>>((resolve) =>
        held.push(() =>
          resolve({
            status: 'completed',
            output: { done: true },
            error: null,
            costUsd: SESSION_COST_USD,
            costSource: 'reported',
            turns: 1,
            durationMs: 10,
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            transcript: [],
          }),
        ),
      ),
  );
}

async function setStatus(patch: Partial<AppSettings>): Promise<void> {
  await writeAppSettings(deps.db, { ...DEFAULT_APP_SETTINGS, ...patch });
}

/** A ready-for-review delivery for a new PR number: round 1 is created queued. */
async function ready(): Promise<Run> {
  const number = nextNumber++;
  const event = await storeGithubEvent(deps, 'pull_request.ready_for_review', {
    fullName: repository.githubFullName,
    pullRequest: { number },
    payload: { number },
  });
  expect(await processGithubEvent(deps, event.id)).toBe('round_started');
  const pullRequest = (await getPullRequest(deps.db, repository.id, number))!;
  const [run] = await deps.db
    .select()
    .from(schema.runs)
    .where(inArray(schema.runs.pullRequestId, [pullRequest.id]));
  return run!;
}

/** The review stage of `run`; it stays pending while its agent session is held. */
function review(run: Run) {
  return executeStage(deps, run.id, 'review');
}

async function waitOf(run: Run) {
  return (await runWaitsOf(deps.db, [run.id])).get(run.id) ?? null;
}

async function prNumber(run: Run): Promise<number> {
  const [row] = await deps.db
    .select({ number: schema.pullRequests.number })
    .from(schema.pullRequests)
    .where(inArray(schema.pullRequests.id, [run.pullRequestId]));
  return row!.number;
}

async function spend(costUsd: number): Promise<void> {
  const { pullRequest } = await upsertPullRequest(
    deps.db,
    aPullRequest(repository.id, { number: nextNumber++ }),
  );
  const run = await insertRun(deps.db, aRun(pullRequest.id, { status: 'completed' }));
  const stage = await insertStageExecution(deps.db, {
    runId: run.id,
    stage: 'review',
    status: 'succeeded',
  });
  await insertAgentSession(deps.db, {
    stageExecutionId: stage.id,
    role: 'reviewer',
    model: 'claude-opus-5-5',
    costUsd,
    costSource: 'reported',
    status: 'succeeded',
  });
}

describe('agent slots', () => {
  test('5 ready events with 2 slots: 2 running, 3 queued slots_busy; a finished one starts the oldest', async () => {
    const runs: Run[] = [];
    for (let i = 0; i < 5; i++) runs.push(await ready());
    const [first, second, ...rest] = runs as [Run, Run, Run, Run, Run];

    const firstDone = review(first);
    const secondDone = review(second);
    await vi.waitFor(() => expect(deps.agentRunner.calls).toHaveLength(2));
    for (const run of rest) expect(await review(run)).toBe('waiting');

    expect((await getRun(deps.db, first.id))!.status).toBe('running');
    expect((await getRun(deps.db, second.id))!.status).toBe('running');
    const busy = [await prNumber(first), await prNumber(second)];
    for (const run of rest) {
      expect((await getRun(deps.db, run.id))!.status).toBe('queued');
      expect((await waitOf(run))?.reason).toEqual({
        code: 'slots_busy',
        params: { slots: 2, prs: busy },
      });
    }

    releaseOldest();
    expect(await firstDone).toBe('succeeded');
    const drained = await drainQueue(deps);
    expect(drained.started).toEqual([rest[0]!.id]);
    expect(await jobsWhere(deps.db, 'run.stage', 'runId', rest[0]!.id)).not.toHaveLength(0);
    expect((await waitOf(rest[0]!))?.reason).toBeNull();
    expect((await waitOf(rest[1]!))?.reason).toMatchObject({ code: 'slots_busy' });

    const thirdDone = review(rest[0]!);
    await vi.waitFor(() => expect(deps.agentRunner.calls).toHaveLength(3));
    expect((await getRun(deps.db, rest[0]!.id))!.status).toBe('running');

    releaseOldest();
    releaseOldest();
    expect(await secondDone).toBe('succeeded');
    expect(await thirdDone).toBe('succeeded');
  });

  test('10 concurrent starts never take more than the slots', async () => {
    const runs: Run[] = [];
    for (let i = 0; i < 10; i++) {
      const { pullRequest } = await upsertPullRequest(
        deps.db,
        aPullRequest(repository.id, { number: nextNumber++ }),
      );
      runs.push(await insertRun(deps.db, aRun(pullRequest.id, { levelNumber: 1 })));
    }
    const pullRequest = (await getPullRequest(deps.db, repository.id, 500))!;

    const decisions = await Promise.all(
      runs.map((run) => queueRoundGate({ deps, run, pullRequest, repository, stage: 'review' })),
    );

    expect(decisions.filter((d) => d.start)).toHaveLength(2);
    const waits = await runWaitsOf(
      deps.db,
      runs.map((run) => run.id),
    );
    expect([...waits.values()].filter((w) => w.admittedAt)).toHaveLength(2);
    expect([...waits.values()].filter((w) => w.reason?.code === 'slots_busy')).toHaveLength(8);
    // The oldest two got the slots.
    expect(waits.get(runs[0]!.id)?.admittedAt).not.toBeNull();
    expect(waits.get(runs[1]!.id)?.admittedAt).not.toBeNull();
  });
});

describe('daily budget', () => {
  test('spend at the budget: no AgentRunner call and the round queued budget_reached', async () => {
    await spend(2);
    await setStatus({ dailyBudgetUsd: 2 });
    const run = await ready();

    expect(await review(run)).toBe('waiting');

    expect(deps.agentRunner.calls).toHaveLength(0);
    expect((await getRun(deps.db, run.id))!.status).toBe('queued');
    const wait = (await waitOf(run))?.reason;
    expect(wait).toMatchObject({ code: 'budget_reached', params: { budgetUsd: 2 } });
    expect((wait?.params as { spentUsd: number }).spentUsd).toBeGreaterThanOrEqual(2);

    // A raised budget lets the drainer start it.
    await setStatus({ dailyBudgetUsd: 100 });
    expect((await drainQueue(deps)).started).toEqual([run.id]);
  });

  test('a running round that hits the budget waits before its next agent stage', async () => {
    const run = await ready();
    const done = review(run);
    await vi.waitFor(() => expect(deps.agentRunner.calls).toHaveLength(1));
    releaseOldest();
    expect(await done).toBe('succeeded');

    // A running run with an agent stage still to go, once the budget is reached.
    const { pullRequest } = await upsertPullRequest(
      deps.db,
      aPullRequest(repository.id, { number: nextNumber++ }),
    );
    const running = await insertRun(
      deps.db,
      aRun(pullRequest.id, { status: 'running', levelNumber: 1, startedAt: new Date() }),
    );
    await setStatus({ dailyBudgetUsd: SESSION_COST_USD });

    expect(await review(running)).toBe('waiting');
    expect(deps.agentRunner.calls).toHaveLength(1);
    expect((await waitOf(running))?.reason).toMatchObject({ code: 'budget_reached' });
    expect((await drainQueue(deps)).resumed).toEqual([]);

    await setStatus({ dailyBudgetUsd: null });
    expect((await drainQueue(deps)).resumed).toEqual([running.id]);
    expect((await waitOf(running))?.reason).toBeNull();
  });
});

describe('pause', () => {
  test('running rounds finish, new ones queue paused, resume starts them by itself', async () => {
    const running = await ready();
    const done = review(running);
    await vi.waitFor(() => expect(deps.agentRunner.calls).toHaveLength(1));

    const tomek = '00000000-0000-4000-8000-000000000007';
    await setStatus({ paused: true, pausedBy: tomek, pausedReason: 'release freeze' });
    const queued = await ready();
    expect(await review(queued)).toBe('waiting');
    expect((await waitOf(queued))?.reason).toEqual({
      code: 'paused',
      params: { by: { kind: 'member', memberId: tomek }, note: 'release freeze' },
    });

    releaseOldest();
    expect(await done).toBe('succeeded');
    expect((await getRun(deps.db, running.id))!.status).toBe('completed');
    expect((await drainQueue(deps)).started).toEqual([]);

    await setStatus({ paused: false });
    expect((await getAppSettings(deps.db)).value.paused).toBe(false);
    expect((await drainQueue(deps)).started).toEqual([queued.id]);
    expect(await jobsWhere(deps.db, 'run.stage', 'runId', queued.id)).not.toHaveLength(0);
    const resumed = review(queued);
    await vi.waitFor(() => expect(deps.agentRunner.calls).toHaveLength(2));
    releaseOldest();
    expect(await resumed).toBe('succeeded');
  });
});
