import { afterEach, expect, test, vi } from 'vitest';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { ApiError, apiGet, apiRequest, CSRF_HEADER } from './api.ts';

afterEach(restoreFetch);

test('every request sends X-PRA-Request: 1', async () => {
  const { calls } = stubFetch({ '/api/prs': { pullRequests: [] }, '/api/x': { ok: true } });

  await apiGet('/api/prs');
  await apiRequest('/api/x', { method: 'POST', body: { a: 1 } });

  expect(calls.map((c) => c.headers[CSRF_HEADER])).toEqual(['1', '1']);
  expect(calls[1]).toMatchObject({ method: 'POST' });
});

test('returns the JSON body on success', async () => {
  stubFetch({ '/api/prs': { pullRequests: [{ number: 1 }] } });

  await expect(apiGet('/api/prs')).resolves.toEqual({ pullRequests: [{ number: 1 }] });
});

test('an api error becomes an ApiError with its code, params and status', async () => {
  stubFetch({
    '/api/prs/wb/9': { status: 404, body: { error: { code: 'pr_not_found', params: { n: 9 } } } },
  });

  const error = await apiGet('/api/prs/wb/9').catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: 'pr_not_found', params: { n: 9 }, status: 404 });
});

test('an error without a code becomes http_error', async () => {
  stubFetch({ '/api/boom': { status: 502, body: 'Bad gateway' } });

  await expect(apiGet('/api/boom')).rejects.toMatchObject({ code: 'http_error', status: 502 });
});

test('a request that gets no answer becomes network_error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

  await expect(apiGet('/api/prs')).rejects.toMatchObject({ code: 'network_error', status: 0 });
});
