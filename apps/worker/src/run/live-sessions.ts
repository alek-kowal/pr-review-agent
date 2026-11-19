// S-03-T3: live cost. The stage executor gets this `AgentRunner` in place of the real one: each
// session gets its `agent_sessions` row when it starts, its cost and tokens grow after every turn
// (the runner's `onProgress`, priced usage = spent money), and when it ends the row takes the
// SDK's reported total. The run's `cost_usd` moves by the same deltas, so it stays the sum of its
// sessions while they run.
import type { AgentProgress, AgentRunInput, AgentRunner, AgentRunResult } from '@pra/agents';
import { addRunCost, insertAgentSession, updateAgentSession, type AgentSession } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';

export type LiveSessions = {
  /** Wraps `deps.agentRunner`; give it to the stage executor. */
  runner: AgentRunner;
  /** The `agent_sessions` row a result was stored in, when this runner ran it. */
  sessionIdOf(result: AgentRunResult<unknown>): number | undefined;
};

type SessionPatch = Partial<Omit<AgentSession, 'id' | 'stageExecutionId' | 'createdAt'>>;

const usageColumns = (usage: AgentProgress['usage']): SessionPatch => ({
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens,
  cacheWriteTokens: usage.cacheWriteTokens,
});

export function liveSessions(
  deps: Pick<WorkerDeps, 'db' | 'agentRunner' | 'logger'>,
  target: { runId: number; stageExecutionId: number },
): LiveSessions {
  const { db, logger } = deps;
  const stored = new WeakMap<object, number>();

  async function run<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    const row = await insertAgentSession(db, {
      stageExecutionId: target.stageExecutionId,
      role: input.role,
      model: input.model,
      costUsd: 0,
      costSource: 'computed',
      status: 'running',
    });
    // `onProgress` is synchronous: writes queue up on one chain, in turn order.
    let recorded = 0;
    let writes = Promise.resolve();
    /** Queues a write; `costUsd` is the session's total so far (omitted: unchanged). */
    const store = (patch: SessionPatch, costUsd?: number) => {
      writes = writes.then(async () => {
        const total = costUsd ?? recorded;
        const delta = total - recorded;
        recorded = total;
        try {
          await db.transaction(async (tx) => {
            await updateAgentSession(tx, row.id, { ...patch, costUsd: total });
            await addRunCost(tx, target.runId, delta);
          });
        } catch (error) {
          recorded -= delta;
          logger.warn({ err: error, sessionId: row.id }, 'live session cost not stored');
        }
      });
    };

    const onProgress = (progress: AgentProgress) => {
      input.onProgress?.(progress);
      store({ ...usageColumns(progress.usage), turns: progress.turns }, progress.costUsd);
    };

    let result: AgentRunResult<T>;
    try {
      result = await deps.agentRunner.run({ ...input, onProgress });
    } catch (error) {
      // The money spent so far stays recorded.
      store({ status: 'failed' });
      await writes;
      throw error;
    }
    store(
      {
        ...usageColumns(result.usage),
        costSource: result.costSource,
        turns: result.turns,
        durationMs: Math.round(result.durationMs),
        status: result.status,
      },
      result.costUsd,
    );
    await writes;
    stored.set(result, row.id);
    return result;
  }

  return {
    runner: { run },
    sessionIdOf: (result) => stored.get(result),
  };
}
