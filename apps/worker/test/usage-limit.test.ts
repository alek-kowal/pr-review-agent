// P-25: a session that hits the Claude usage limit parks its stage (no failed attempt, no new
// attempt number), holds every other run until just after the reset, and the drainer then lets
// the parked stage go on as the same attempt.
import type { AgentRunResult } from '@pra/agents';
import {
  eq,
  getPullRequest,
  getRun,
  getUsageLimitHold,
  inArray,
  runWaitsOf,
  schema,
  sql,
  type Repository,
  type Run,
} from '@pra/db';
import { createTestDatabase, type TestDatabase } from '@pra/db/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { processGithubEvent } from '../src/handlers/github-event.ts';
import { drainQueue } from '../src/run/drain.ts';
import { executeStage } from '../src/run/execute-stage.ts';
import { RUN_GATES } from '../src/run/gates.ts';
import { STAGE_EXECUTORS } from '../src/stages/index.ts';
import type { StageExecutor } from '../src/stages/stage.ts';
import {
  connectRepository,
  createTestWorkerDeps,
  storeGithubEvent,
  type TestWorkerDeps,
} from './support.ts';

/** A review stage with one session that fails with the agent's error, like the real stages. */
const reviewOnce: StageExecutor = {
  key: 'review',
  usesAgent: true,
  async run({ deps, run }) {
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
    const sessions = [{ role: 'reviewer' as const, model: 'claude-opus-5-5', prompt: '', result }];
    if (result.status !== 'completed') {
      return { status: 'failed', error: result.error!, sessions };
    }
    return {
      status: 'succeeded',
      output: {},
      sessions,
      findings: [],
      questions: [],
      notChecked: [],
    };
  },
};

const session = (patch: Partial<AgentRunResult<unknown>>) => (): AgentRunResult<unknown> => ({
  status: 'completed',
  output: {},
  error: null,
  costUsd: 0.25,
  costSource: 'reported',
  turns: 1,
  durationMs: 10,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  transcript: [],
  ...patch,
});

let database: TestDatabase;
let deps: TestWorkerDeps;
let repository: Repository;
let nextNumber = 700;

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
  await deps.close();
  await database.drop();
});

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

const reviewRows = (run: Run) =>
  deps.db
    .select()
    .from(schema.stageExecutions)
    .where(sql`${schema.stageExecutions.runId} = ${run.id} and stage = 'review'`);

const waitOf = async (run: Run) => (await runWaitsOf(deps.db, [run.id])).get(run.id)?.reason;

describe('the Claude usage limit', () => {
  test('parks the stage, holds other runs until the reset, then resumes the same attempt', async () => {
    const resetsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const until = new Date(Date.parse(resetsAt) + 60_000).toISOString();
    deps.agentRunner.enqueue(
      session({
        status: 'failed',
        output: null,
        error: { code: 'usage_limit_reached', params: { resetsAt } },
      }),
    );
    const first = await ready();
    expect(await executeStage(deps, first.id, 'review')).toBe('waiting');

    // No failed attempt: attempt 1 is pending again, the run keeps running and waits.
    const [parked] = await reviewRows(first);
    expect(parked).toMatchObject({
      attempt: 1,
      status: 'pending',
      errorCode: 'usage_limit_reached',
    });
    expect((await getRun(deps.db, first.id))!.status).toBe('running');
    const reason = { code: 'usage_limit_reached', params: { until, resetsAt } };
    expect(await waitOf(first)).toEqual(reason);
    expect(await getUsageLimitHold(deps.db)).toEqual({ until, resetsAt });
    // A drain just after the reset, under its own singleton key.
    const drains = await deps.db.execute<{ singleton_key: string; start_after: Date }>(
      sql`select singleton_key, start_after from pgboss.job where name = 'run.drain'
          and singleton_key = ${`usage-limit:${until}`}`,
    );
    expect(drains.rows).toHaveLength(1);
    expect(new Date(drains.rows[0]!.start_after).toISOString()).toBe(until);

    // Another PR's round waits for the same hold; the drainer resumes nothing yet.
    const second = await ready();
    expect(await executeStage(deps, second.id, 'review')).toBe('waiting');
    expect(await waitOf(second)).toEqual(reason);
    expect(await drainQueue(deps)).toEqual({ started: [], resumed: [] });
    expect(deps.agentRunner.calls).toHaveLength(1);

    // The reset passes: the drainer lets the parked run go on, as the same attempt.
    await deps.db
      .update(schema.usageLimitHolds)
      .set({ until: new Date(Date.now() - 1_000) })
      .where(eq(schema.usageLimitHolds.id, 1));
    const drained = await drainQueue(deps);
    expect(drained.resumed).toContain(first.id);
    expect(drained.started).toContain(second.id);
    deps.agentRunner.enqueue(session({}));
    expect(await executeStage(deps, first.id, 'review')).toBe('succeeded');

    const rows = await reviewRows(first);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ attempt: 1, status: 'succeeded', errorCode: null });
    const sessions = await deps.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.stageExecutionId, rows[0]!.id));
    expect(sessions.map((s) => s.transcriptBlobKey).sort()).toEqual([
      `runs/${first.id}/review-1/session-1/transcript.json`,
      `runs/${first.id}/review-1/session-2/transcript.json`,
    ]);
    expect(await waitOf(first)).toBeNull();
  });
});
