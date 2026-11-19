import { closeDb, createDb, createQueue } from '@pra/db';
import { testDatabaseUrl } from '@pra/db/testing';
import { Writable } from 'node:stream';
import { expect, onTestFinished, test } from 'vitest';
import { buildServer, serverOptions } from '../src/server.ts';

async function serverWithCapturedLogs() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const options = serverOptions({ NODE_ENV: 'production' });
  const db = createDb(testDatabaseUrl(), { max: 1 });
  const deps = { db, queue: createQueue(testDatabaseUrl()) };
  const server = await buildServer(deps, {
    ...options,
    logger: { ...Object(options.logger), stream },
  });
  onTestFinished(async () => {
    await server.close();
    await closeDb(db);
  });
  return { server, lines };
}

test('request logs carry the service name and the caller’s X-Request-Id', async () => {
  const { server, lines } = await serverWithCapturedLogs();

  const res = await server.inject({ url: '/', headers: { 'x-request-id': 'req-abc' } });

  expect(res.statusCode).toBe(200);
  expect(lines).toContainEqual(
    expect.objectContaining({ service: 'api', reqId: 'req-abc', msg: 'incoming request' }),
  );
});

test('requests without X-Request-Id get a UUID', async () => {
  const { server, lines } = await serverWithCapturedLogs();

  await server.inject({ url: '/' });

  const incoming = lines.find((line) => line.msg === 'incoming request');
  expect(incoming?.reqId).toMatch(/^[0-9a-f-]{36}$/);
});
