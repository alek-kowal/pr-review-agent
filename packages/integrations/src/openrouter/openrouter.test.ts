import { describe, expect, test } from 'vitest';
import { IntegrationError } from '../errors.ts';
import { FakeOpenRouterClient, openRouterChat } from '../testing/openrouter.ts';
import {
  createOpenRouterClient,
  HttpOpenRouterClient,
  OPENROUTER_API,
} from './http-openrouter-client.ts';
import type { OpenRouterChatRequest } from './openrouter-client.ts';

const KEY = 'sk-or-test-never-logged';
const REQUEST: OpenRouterChatRequest = {
  model: 'typesafe/jev-router',
  messages: [{ role: 'user', content: 'Classify.' }],
  provider: { data_collection: 'deny' },
  usage: { include: true },
};

type Call = { url: string; init: RequestInit };

/** A `fetch` stub: answers `body` with `status`, and records the call. */
function stubFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

async function failure(promise: Promise<unknown>): Promise<IntegrationError> {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(thrown).toBeInstanceOf(IntegrationError);
  return thrown as IntegrationError;
}

describe('HttpOpenRouterClient', () => {
  test('posts the request as given, with the key only in the authorization header', async () => {
    const calls: Call[] = [];
    const chat = openRouterChat();
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch: stubFetch(200, chat, calls) });

    await expect(client.chat(REQUEST)).resolves.toEqual(chat);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${OPENROUTER_API}/chat/completions`);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    // No attribution headers: only what the request needs.
    expect(Object.keys(headers).sort()).toEqual(['accept', 'authorization', 'content-type']);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(REQUEST);
  });

  test.each([
    [401, 'openrouter_auth_failed'],
    [402, 'openrouter_no_credits'],
    [408, 'openrouter_timeout'],
    [429, 'openrouter_rate_limited'],
    [503, 'openrouter_unavailable'],
    [500, 'openrouter_error'],
  ])('maps HTTP %i to %s, with the key removed from the detail', async (status, code) => {
    const body = { error: { code: status, message: `failed for key ${KEY}` } };
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch: stubFetch(status, body) });

    const error = await failure(client.chat(REQUEST));
    expect(error.code).toBe(code);
    expect(error.params).toEqual({ status, detail: 'failed for key [redacted]' });
    expect(`${error.message} ${JSON.stringify(error.params)}`).not.toContain(KEY);
  });

  test('an error body sent with 200 is an error too', async () => {
    const body = { error: { code: 402, message: 'Insufficient credits' } };
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch: stubFetch(200, body) });
    expect((await failure(client.chat(REQUEST))).code).toBe('openrouter_no_credits');
  });

  test('a body without choices fails openrouter_error', async () => {
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch: stubFetch(200, { id: 'x' }) });
    expect((await failure(client.chat(REQUEST))).code).toBe('openrouter_error');
  });

  test('its own timeout fails openrouter_timeout', async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch: hang, timeoutMs: 5 });
    const error = await failure(client.chat(REQUEST));
    expect(error.code).toBe('openrouter_timeout');
    expect(error.params).toEqual({ timeoutMs: 5 });
  });

  test("the caller's abort is passed on as it is, not as a timeout", async () => {
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
      })) as typeof fetch;
    const client = new HttpOpenRouterClient({ apiKey: KEY, fetch: hang });
    const controller = new AbortController();
    const pending = client.chat(REQUEST, { signal: controller.signal });
    controller.abort(new Error('cancelled by hand'));
    await expect(pending).rejects.toThrow('cancelled by hand');
  });

  test('createOpenRouterClient needs OPENROUTER_API_KEY; blank counts as unset', () => {
    expect(createOpenRouterClient({})).toBeNull();
    expect(createOpenRouterClient({ OPENROUTER_API_KEY: '  ' })).toBeNull();
    expect(createOpenRouterClient({ OPENROUTER_API_KEY: KEY })).toBeInstanceOf(
      HttpOpenRouterClient,
    );
  });
});

describe('FakeOpenRouterClient', () => {
  test('records requests and answers from its queue, the last reply repeating', async () => {
    const fake = new FakeOpenRouterClient(openRouterChat('a'), new Error('down'));
    await expect(fake.chat(REQUEST)).resolves.toMatchObject({ id: 'gen-1' });
    await expect(fake.chat(REQUEST)).rejects.toThrow('down');
    await expect(fake.chat(REQUEST)).rejects.toThrow('down');
    expect(fake.requests).toHaveLength(3);
  });
});
