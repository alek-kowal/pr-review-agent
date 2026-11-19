import { mkdtemp, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isHeartbeatFresh, startHeartbeat } from './heartbeat.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'pra-heartbeat-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('heartbeat', () => {
  it('writes the file at once, so a started worker is healthy', async () => {
    const file = path.join(dir, 'beat');
    const heartbeat = startHeartbeat(file, { intervalMs: 60_000 });
    await expect.poll(() => isHeartbeatFresh(file)).toBe(true);
    heartbeat.stop();
  });

  it('is unhealthy when the file is missing or too old', async () => {
    const file = path.join(dir, 'beat');
    expect(await isHeartbeatFresh(file)).toBe(false);

    startHeartbeat(file, { intervalMs: 60_000 }).stop();
    // Wait until the first write has finished, so it cannot land after `utimes`.
    await expect.poll(() => readFile(file, 'utf8').catch(() => '')).not.toBe('');
    const old = new Date(Date.now() - 120_000);
    await utimes(file, old, old);
    expect(await isHeartbeatFresh(file)).toBe(false);
  });
});
