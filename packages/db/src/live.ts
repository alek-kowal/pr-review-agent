// S-03-T1: change notifications. Triggers on the watched tables send `pra_change` with
// {table, id, prId, runId} (migration 0006); `listenChanges` holds one dedicated connection that
// LISTENs and comes back after the connection drops.
import pg from 'pg';
import type { Db } from './client.ts';

export const CHANGE_CHANNEL = 'pra_change';
/** `application_name` of the listening connection, so it can be found in `pg_stat_activity`. */
export const LISTENER_APPLICATION_NAME = 'pra-live';

export type ChangeEvent = {
  table: string;
  id: number | string | null;
  prId: number | null;
  runId: number | null;
};

export type ListenOptions = {
  /** Called after a dropped connection is back; changes in the gap were not delivered. */
  onReconnect?: () => void;
  /** Connection errors; the listener retries by itself. */
  onError?: (error: Error) => void;
  /** First retry delay; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
};

export type ChangeListener = {
  /** Resolves once the first LISTEN is active. */
  ready: Promise<void>;
  close(): Promise<void>;
};

/** Parses a notification payload; null when it is not one of ours. */
export function parseChange(payload: string | undefined): ChangeEvent | null {
  if (!payload) return null;
  try {
    const value = JSON.parse(payload) as Partial<ChangeEvent>;
    if (typeof value.table !== 'string') return null;
    return {
      table: value.table,
      id: value.id ?? null,
      prId: value.prId ?? null,
      runId: value.runId ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Listens to `pra_change` on its own connection (not a pool slot). When the connection drops,
 * it reconnects with backoff, LISTENs again and calls `onReconnect`.
 */
export function listenChanges(
  source: Db | string,
  onChange: (change: ChangeEvent) => void,
  options: ListenOptions = {},
): ChangeListener {
  const config: pg.ClientConfig =
    typeof source === 'string'
      ? { connectionString: source }
      : { ...(source.$client.options as pg.ClientConfig) };
  const firstRetry = options.retryMs ?? 100;
  const maxRetry = options.maxRetryMs ?? 5_000;
  let client: pg.Client | null = null;
  let closed = false;
  let connectedOnce = false;
  let retry = firstRetry;
  let timer: NodeJS.Timeout | undefined;
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => (resolveReady = resolve));

  const scheduleReconnect = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void connect();
    }, retry);
    retry = Math.min(retry * 2, maxRetry);
  };

  const drop = (current: pg.Client, error?: Error) => {
    if (client !== current) return;
    client = null;
    if (error) options.onError?.(error);
    current.removeAllListeners('notification');
    current.end().catch(() => {});
    scheduleReconnect();
  };

  async function connect(): Promise<void> {
    if (closed) return;
    const current = new pg.Client({ ...config, application_name: LISTENER_APPLICATION_NAME });
    client = current;
    current.on('error', (error) => drop(current, error));
    current.on('end', () => drop(current));
    current.on('notification', (message) => {
      if (message.channel !== CHANGE_CHANNEL) return;
      const change = parseChange(message.payload);
      if (change) onChange(change);
    });
    try {
      await current.connect();
      await current.query(`LISTEN ${CHANGE_CHANNEL}`);
    } catch (error) {
      drop(current, error as Error);
      return;
    }
    if (closed || client !== current) {
      await current.end().catch(() => {});
      return;
    }
    retry = firstRetry;
    if (connectedOnce) options.onReconnect?.();
    connectedOnce = true;
    resolveReady();
  }

  void connect();

  return {
    ready,
    async close() {
      closed = true;
      clearTimeout(timer);
      const current = client;
      client = null;
      resolveReady();
      if (current) {
        current.removeAllListeners('notification');
        await current.end().catch(() => {});
      }
    },
  };
}
