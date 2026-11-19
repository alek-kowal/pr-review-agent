import { closeDb, createDb, insertRun, sql } from '@pra/db';
import { aRun, seedPullRequest, testDatabaseUrl } from '@pra/db/testing';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { HEARTBEAT_MS, LiveHub, SSE_HEARTBEAT } from '../../src/live/hub.ts';
import { build } from '../helper.ts';

const writer = createDb(testDatabaseUrl(), { max: 1 });
afterAll(() => closeDb(writer));
afterEach(() => vi.useRealTimers());

type Stream = { text: () => string; abort: () => void };

/** Opens `/api/live` and resolves once the server says it listens. */
async function connect(base: string): Promise<Stream> {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/live`, { signal: controller.signal });
  expect(response.headers.get('content-type')).toMatch(/^text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      // Aborted.
    }
  })();
  await vi.waitFor(() => expect(text).toContain(': connected'));
  return { text: () => text, abort: () => controller.abort() };
}

const changesFor = (stream: Stream, runId: number) =>
  stream
    .text()
    .split('\n\n')
    .filter((message) => message.startsWith('event: change\n'))
    .map((message) => JSON.parse(message.split('\ndata: ')[1]!) as { table: string; id: number })
    .filter((change) => change.table === 'runs' && change.id === runId);

describe('GET /api/live', () => {
  test('two clients each receive a run update within 1 s; the fan-out empties after they leave', async () => {
    const hub = new LiveHub();
    const app = await build({ live: hub });
    const base = await app.listen({ port: 0, host: '127.0.0.1' });
    const { pullRequest } = await seedPullRequest(writer);
    const run = await insertRun(writer, aRun(pullRequest.id));

    const [first, second] = await Promise.all([connect(base), connect(base)]);
    expect(hub.size).toBe(2);

    await writer.execute(sql`update runs set status = 'running' where id = ${run.id}`);
    await vi.waitFor(
      () => {
        expect(changesFor(first, run.id)).toEqual([
          { table: 'runs', id: run.id, prId: pullRequest.id, runId: run.id },
        ]);
        expect(changesFor(second, run.id)).toHaveLength(1);
      },
      { timeout: 1_000 },
    );

    first.abort();
    second.abort();
    await vi.waitFor(() => expect(hub.size).toBe(0));
  });

  test('closing the api ends open streams', async () => {
    const hub = new LiveHub();
    const app = await build({ live: hub });
    await connect(await app.listen({ port: 0, host: '127.0.0.1' }));
    await app.close();
    expect(hub.size).toBe(0);
  });
});

describe('LiveHub', () => {
  test('sends a heartbeat comment every 15 s while a client is connected', () => {
    vi.useFakeTimers();
    const hub = new LiveHub();
    const written: string[] = [];
    const remove = hub.add({ write: (chunk) => written.push(chunk) });

    vi.advanceTimersByTime(HEARTBEAT_MS - 1);
    expect(written).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(written).toEqual([SSE_HEARTBEAT]);

    remove();
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(written).toEqual([SSE_HEARTBEAT]);
    expect(hub.size).toBe(0);
  });

  test('a client whose stream throws is dropped', () => {
    const hub = new LiveHub();
    hub.add({
      write: () => {
        throw new Error('closed');
      },
    });
    hub.broadcast('change', { table: 'runs' });
    expect(hub.size).toBe(0);
    hub.close();
  });
});
