import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aPrView } from '@/test/fixtures.ts';
import { LIVE_URL, RETRY_MIN_MS, useLiveUpdates, type LiveSource } from './useLiveUpdates.ts';

/** An `EventSource` double: the test sends events and can drop the connection. */
class FakeSource implements LiveSource {
  static all: FakeSource[] = [];
  readyState = 0;
  closed = false;
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSource.all.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string, data?: unknown) {
    if (type === 'open') this.readyState = 1;
    const event = new MessageEvent(type, {
      data: data === undefined ? undefined : JSON.stringify(data),
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const connect = (url: string) => new FakeSource(url);

function Live() {
  useLiveUpdates({ connect });
  return null;
}

// The PR shown under ['pr', 'wb', '12'] has id 7 (fixture).
const KEYS: Record<string, QueryKey> = {
  board: ['board'],
  prView: ['pr', 'wb', '12'],
  prFindings: ['pr', 'wb', '12', 'findings'],
  prTimeline: ['pr', 'wb', '12', 'timeline'],
  otherPr: ['pr', 'wb', '13'],
  run: ['run', 31],
  otherRun: ['run', 32],
  activity: ['activity', 'in-progress'],
  status: ['status'],
  team: ['team'],
};

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of Object.values(KEYS)) queryClient.setQueryData(key, {});
  queryClient.setQueryData(KEYS.prView!, aPrView({ number: 12 }));
  queryClient.setQueryData(KEYS.otherPr!, {
    ...aPrView({ number: 13 }),
    pullRequest: { ...aPrView().pullRequest, id: 8, number: 13 },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Live />
    </QueryClientProvider>,
  );
  const invalidated = () =>
    Object.entries(KEYS)
      .filter(([, key]) => queryClient.getQueryState(key)?.isInvalidated)
      .map(([name]) => name)
      .sort();
  return { queryClient, view, invalidated, source: () => FakeSource.all.at(-1)! };
}

beforeEach(() => {
  FakeSource.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useLiveUpdates', () => {
  it('opens one connection to /api/live and closes it on unmount', () => {
    const { view } = setup();
    expect(FakeSource.all).toHaveLength(1);
    expect(FakeSource.all[0]!.url).toBe(LIVE_URL);
    view.unmount();
    expect(FakeSource.all[0]!.closed).toBe(true);
  });

  it('a change of a run invalidates exactly the run, PR summary, board and activity queries', async () => {
    const { source, invalidated } = setup();
    act(() => source().emit('change', { table: 'runs', id: 31, prId: 7, runId: 31 }));
    expect(invalidated()).toEqual([]); // batched
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(invalidated()).toEqual(['activity', 'board', 'prView', 'run']);
  });

  it('a session cost change also refreshes the status chip', async () => {
    const { source, invalidated } = setup();
    act(() => source().emit('change', { table: 'agent_sessions', id: 3, prId: 7, runId: 31 }));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(invalidated()).toEqual(['activity', 'prView', 'run', 'status']);
  });

  it('findings and timeline entries refresh their tab only', async () => {
    const { source, invalidated } = setup();
    act(() => {
      source().emit('change', { table: 'findings', id: 1, prId: 7, runId: 31 });
      source().emit('change', { table: 'timeline_entries', id: 4, prId: 7, runId: null });
    });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(invalidated()).toEqual(['board', 'prFindings', 'prTimeline', 'prView']);
  });

  it('a resync, and a reconnect after the stream closed, invalidate everything', async () => {
    const { source, invalidated, queryClient } = setup();
    act(() => source().emit('resync', {}));
    expect(invalidated()).toEqual(Object.keys(KEYS).sort());

    for (const key of Object.values(KEYS)) queryClient.setQueryData(key, {});
    const first = source();
    act(() => {
      first.readyState = 2;
      first.emit('error');
    });
    expect(FakeSource.all).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(RETRY_MIN_MS));
    expect(FakeSource.all).toHaveLength(2);
    expect(invalidated()).toEqual([]);
    act(() => source().emit('open'));
    expect(invalidated()).toEqual(Object.keys(KEYS).sort());
  });
});
