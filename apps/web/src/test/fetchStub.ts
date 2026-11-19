import { vi } from 'vitest';

/** One canned answer: a JSON body and its status (200 when left out). */
export type StubbedResponse = { status?: number; body: unknown };

export type FetchCall = {
  path: string;
  method: string;
  headers: Record<string, string>;
  /** The parsed JSON body, when the request sent one. */
  body?: unknown;
};

/**
 * Replaces `fetch` with a table of canned answers keyed by path (with its query string), e.g.
 * `'/api/prs?repo=wb'`, or by method and path, e.g. `'POST /api/team'`, which wins over the bare
 * path. A path missing from the table answers 404 so a test sees what it forgot.
 * Restore with `vi.unstubAllGlobals()` (or `restoreFetch`).
 */
export function stubFetch(routes: Record<string, StubbedResponse | unknown>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input), 'http://localhost');
    const path = url.pathname + url.search;
    const method = init?.method ?? 'GET';
    calls.push({
      path,
      method,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
    });
    const entry = routes[`${method} ${path}`] ?? routes[path];
    if (entry === undefined) {
      return json({ error: { code: 'not_stubbed', params: { path } } }, 404);
    }
    const { status = 200, body } = isStubbedResponse(entry) ? entry : { body: entry };
    return json(body, status);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const restoreFetch = () => vi.unstubAllGlobals();

const isStubbedResponse = (value: unknown): value is StubbedResponse =>
  typeof value === 'object' && value !== null && 'body' in value;

// 204 and 205 answers may not carry a body.
const json = (body: unknown, status: number) =>
  status === 204 || status === 205
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
