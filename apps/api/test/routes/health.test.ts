import { closeDb, createDb } from '@pra/db';
import { expect, onTestFinished, test } from 'vitest';
import { build } from '../helper.ts';

test('GET /health is 200 when the database answers', async () => {
  const app = await build();

  const res = await app.inject({ url: '/health' });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
});

test('GET /health is 503 when the database is unreachable', async () => {
  // Nothing listens on port 1, so the connection is refused at once.
  const db = createDb('postgres://pra:pra@127.0.0.1:1/pra', { connectionTimeoutMillis: 1_000 });
  onTestFinished(() => closeDb(db));
  const app = await build({ db });

  const res = await app.inject({ url: '/health' });

  expect(res.statusCode).toBe(503);
  expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
});
