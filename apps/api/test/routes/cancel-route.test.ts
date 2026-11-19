// S-09-T4: Cancel by hand. The api records who asked and why; the worker finishes the cancel.
import {
  closeDb,
  createDb,
  getRun,
  insertRun,
  upsertRepository,
  type Repository,
  type Run,
} from '@pra/db';
import { aRepositoryConfig, aRun, testDatabaseUrl } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { CancelRunResponse } from '../../src/routes/api/runs/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { seedPr } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });

let app: FastifyInstance;
let repository: Repository;

beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig({ slug: 'cancel-route' }));
});
afterAll(async () => {
  await closeDb(db);
});
beforeEach(async () => {
  app = await build({ db });
});

const cancel = (runId: number, headers: Record<string, string> = SAME_ORIGIN) =>
  app.inject({ method: 'POST', url: `/api/runs/${runId}/cancel`, headers });

async function seedRun(status: Run['status']): Promise<Run> {
  const pullRequest = await seedPr(db, repository.id);
  return insertRun(db, aRun(pullRequest.id, { status }));
}

describe('cancel a run', () => {
  test.each(['queued', 'running'] as const)(
    'a %s run gets a cancel request by hand; the worker sets cancelled',
    async (status) => {
      const run = await seedRun(status);

      const response = await cancel(run.id);

      expect(response.statusCode).toBe(202);
      expect(CancelRunResponse.parse(response.json())).toEqual({ status: 'cancelling' });
      const stored = await getRun(db, run.id);
      expect(stored).toMatchObject({
        status,
        cancelledBy: 'hand',
        cancelledByMemberId: null,
        cancelReason: 'by_hand',
      });
      expect(stored?.cancelRequestedAt).toBeInstanceOf(Date);
    },
  );

  test('a second cancel is accepted and keeps the first request', async () => {
    const run = await seedRun('running');
    await cancel(run.id);
    const first = (await getRun(db, run.id))?.cancelRequestedAt;

    expect((await cancel(run.id)).statusCode).toBe(202);
    expect((await getRun(db, run.id))?.cancelRequestedAt).toEqual(first);
  });

  test.each(['completed', 'failed', 'cancelled'] as const)(
    '409 run_finished for a %s run',
    async (status) => {
      const run = await seedRun(status);

      const response = await cancel(run.id);

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: { code: 'run_finished', params: { status } } });
      expect((await getRun(db, run.id))?.cancelRequestedAt).toBeNull();
    },
  );

  test('404 for an unknown run, 403 without the request header', async () => {
    expect((await cancel(999_999)).statusCode).toBe(404);
    const run = await seedRun('running');
    expect((await cancel(run.id, {})).statusCode).toBe(403);
    expect((await getRun(db, run.id))?.cancelRequestedAt).toBeNull();
  });
});
