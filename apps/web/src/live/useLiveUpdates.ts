import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { invalidateForChanges, parseChange, type LiveChange } from './changes.ts';

export const LIVE_URL = '/api/live';
/** Changes that arrive within this window are invalidated together (a turn writes several rows). */
export const FLUSH_MS = 150;
export const RETRY_MIN_MS = 1_000;
export const RETRY_MAX_MS = 30_000;

/** The part of `EventSource` the live connection uses; tests pass a double. */
export type LiveSource = {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
};

export type LiveOptions = { connect?: (url: string) => LiveSource };

const CLOSED = 2;

/**
 * Opens `GET /api/live` and turns its change events into query invalidations. Native
 * `EventSource` retries a dropped connection itself; when it gives up (closed), this opens a new
 * one with backoff. Changes made while disconnected are lost, so after a reconnect, and on the
 * server's `resync`, every query is invalidated. Returns the function that stops it.
 */
export function startLiveUpdates(queryClient: QueryClient, options: LiveOptions = {}): () => void {
  const connect =
    options.connect ??
    (typeof EventSource === 'undefined' ? null : (url: string) => new EventSource(url));
  if (!connect) return () => {};

  let source: LiveSource | null = null;
  let stopped = false;
  let lostChanges = false;
  let retryMs = RETRY_MIN_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pending: LiveChange[] = [];

  const flush = () => {
    flushTimer = undefined;
    const changes = pending;
    pending = [];
    void invalidateForChanges(queryClient, changes);
  };
  const invalidateAll = () => {
    pending = [];
    void queryClient.invalidateQueries();
  };

  const open = () => {
    if (stopped) return;
    const current = connect(LIVE_URL);
    source = current;
    current.addEventListener('open', () => {
      retryMs = RETRY_MIN_MS;
      if (lostChanges) {
        lostChanges = false;
        invalidateAll();
      }
    });
    current.addEventListener('change', (event) => {
      const change = parseChange(event.data);
      if (!change) return;
      pending.push(change);
      flushTimer ??= setTimeout(flush, FLUSH_MS);
    });
    current.addEventListener('resync', invalidateAll);
    current.addEventListener('error', () => {
      lostChanges = true;
      if (current.readyState !== CLOSED || stopped) return;
      current.close();
      retryTimer = setTimeout(open, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    });
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    clearTimeout(flushTimer);
    source?.close();
  };
}

/** One live connection for the app shell: mount it once, in the root layout. */
export function useLiveUpdates(options?: LiveOptions) {
  const queryClient = useQueryClient();
  const connect = options?.connect;
  useEffect(() => startLiveUpdates(queryClient, { connect }), [queryClient, connect]);
}
