import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  closeDb,
  createDb,
  insertRun,
  insertStageExecution,
  listenChanges,
  LISTENER_APPLICATION_NAME,
  sql,
  updateStageExecution,
  type ChangeEvent,
} from './index.ts';
import { aRun, seedPullRequest, testDatabaseUrl } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 2 });
afterAll(() => closeDb(db));

async function seedStage() {
  const { pullRequest } = await seedPullRequest(db);
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'running' }));
  const stage = await insertStageExecution(db, {
    runId: run.id,
    stage: 'review',
    attempt: 1,
    status: 'running',
  });
  return { prId: pullRequest.id, runId: run.id, stageId: stage.id };
}

const ofStage = (events: ChangeEvent[], id: number) =>
  events.filter((event) => event.table === 'stage_executions' && event.id === id);

describe('change notifications', () => {
  test('a stage update delivers exactly one payload with its prId and runId within 1 s', async () => {
    const { prId, runId, stageId } = await seedStage();
    const events: ChangeEvent[] = [];
    const listener = listenChanges(testDatabaseUrl(), (event) => events.push(event));
    try {
      await listener.ready;
      await updateStageExecution(db, stageId, { status: 'succeeded', finishedAt: new Date() });
      await vi.waitFor(() => expect(ofStage(events, stageId)).toHaveLength(1), { timeout: 1_000 });
      expect(ofStage(events, stageId)[0]).toEqual({
        table: 'stage_executions',
        id: stageId,
        prId,
        runId,
      });
      // Nothing else arrives for the same row.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(ofStage(events, stageId)).toHaveLength(1);
    } finally {
      await listener.close();
    }
  });

  test('the listener receives events again after its backend is killed', async () => {
    const { stageId } = await seedStage();
    const events: ChangeEvent[] = [];
    let reconnects = 0;
    const listener = listenChanges(testDatabaseUrl(), (event) => events.push(event), {
      retryMs: 20,
      onReconnect: () => reconnects++,
    });
    try {
      await listener.ready;
      const killed = await db.execute<{ pid: number }>(sql`
        select pg_terminate_backend(pid) as killed, pid from pg_stat_activity
        where datname = current_database() and application_name = ${LISTENER_APPLICATION_NAME}`);
      expect(killed.rows).toHaveLength(1);
      await vi.waitFor(() => expect(reconnects).toBe(1), { timeout: 5_000 });

      await updateStageExecution(db, stageId, { status: 'failed', finishedAt: new Date() });
      await vi.waitFor(() => expect(ofStage(events, stageId)).toHaveLength(1), { timeout: 1_000 });
    } finally {
      await listener.close();
    }
  });

  test('payloads name the PR for runs, sessions and pull requests', async () => {
    const { prId, runId, stageId } = await seedStage();
    const events: ChangeEvent[] = [];
    const listener = listenChanges(db, (event) => events.push(event));
    try {
      await listener.ready;
      await db.execute(sql`update runs set status = 'completed' where id = ${runId}`);
      await db.execute(sql`update pull_requests set title = title || '!' where id = ${prId}`);
      const session = await db.execute<{ id: number }>(sql`
        insert into agent_sessions (stage_execution_id, role, model, status, cost_source)
        values (${stageId}, 'reviewer', 'claude-opus-5-5', 'completed', 'reported') returning id`);
      const sessionId = session.rows[0]!.id;
      await vi.waitFor(() =>
        expect(events).toEqual(
          expect.arrayContaining([
            { table: 'runs', id: runId, prId, runId },
            { table: 'pull_requests', id: prId, prId, runId: null },
            { table: 'agent_sessions', id: sessionId, prId, runId },
          ]),
        ),
      );
    } finally {
      await listener.close();
    }
  });
});
