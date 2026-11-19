import { stat, writeFile } from 'node:fs/promises';

export const HEARTBEAT_INTERVAL_MS = 10_000;
/** Older than this, the worker counts as hung (three missed beats). */
export const HEARTBEAT_MAX_AGE_MS = 3 * HEARTBEAT_INTERVAL_MS;

export type Heartbeat = { stop: () => void };

/**
 * Writes `file` now and then every `intervalMs` while the worker runs. The container healthcheck
 * (`healthcheck.ts`) reads its age: a blocked event loop or a stopped worker stops the beats.
 */
export function startHeartbeat(
  file: string,
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): Heartbeat {
  const beat = () => {
    writeFile(file, new Date().toISOString()).catch((error: unknown) => options.onError?.(error));
  };
  beat();
  const timer = setInterval(beat, options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

/** True when `file` exists and was written within `maxAgeMs`. */
export async function isHeartbeatFresh(
  file: string,
  maxAgeMs = HEARTBEAT_MAX_AGE_MS,
  now = Date.now(),
): Promise<boolean> {
  try {
    const { mtimeMs } = await stat(file);
    return now - mtimeMs <= maxAgeMs;
  } catch {
    return false;
  }
}
