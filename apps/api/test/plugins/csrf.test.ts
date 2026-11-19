import Fastify, { type FastifyInstance } from 'fastify';
import { describe, expect, test } from 'vitest';
import Csrf from '../../src/plugins/csrf.ts';
import Errors from '../../src/plugins/errors.ts';
import { serverOptions, trustProxyFrom } from '../../src/server.ts';
import { build, SAME_ORIGIN } from '../helper.ts';

const REJECTED = { error: { code: 'csrf_rejected', params: {} } };
const HOST = 'pra.example.com';

/** The guard on a bare Fastify with one route per method, so no database is needed. */
async function guarded(env: NodeJS.ProcessEnv = {}): Promise<FastifyInstance> {
  const fastify = Fastify({ ...serverOptions(env), logger: false });
  await fastify.register(Errors);
  await fastify.register(Csrf);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    fastify.route({ method, url: '/things', handler: async () => ({ ok: true }) });
  }
  fastify.post('/webhooks/github', async () => ({ received: true }));
  await fastify.ready();
  return fastify;
}

describe('CSRF guard', () => {
  test.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s from the same origin with the header passes',
    async (method) => {
      const app = await guarded();
      const res = await app.inject({
        method,
        url: '/things',
        headers: { host: HOST, origin: `https://${HOST}`, 'x-pra-request': '1' },
      });
      expect(res.statusCode).toBe(200);
    },
  );

  test.each([
    ['a missing header', { origin: `https://${HOST}` }],
    ['a wrong header value', { origin: `https://${HOST}`, 'x-pra-request': 'true' }],
    ['a foreign Origin', { origin: 'https://evil.example', 'x-pra-request': '1' }],
    ['a look-alike Origin', { origin: `https://${HOST}.evil.example`, 'x-pra-request': '1' }],
    ['a missing Origin', { 'x-pra-request': '1' }],
    ['an opaque Origin', { origin: 'null', 'x-pra-request': '1' }],
    ['a malformed Origin', { origin: 'not a url', 'x-pra-request': '1' }],
  ])('%s gets 403 csrf_rejected', async (_case, headers) => {
    const app = await guarded();
    for (const method of ['POST', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/things', headers: { host: HOST, ...headers } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(REJECTED);
    }
  });

  test('a default port in Host or Origin still counts as the same host', async () => {
    const app = await guarded();
    const res = await app.inject({
      method: 'POST',
      url: '/things',
      headers: { host: `${HOST}:443`, origin: `https://${HOST}`, 'x-pra-request': '1' },
    });
    expect(res.statusCode).toBe(200);
  });

  test('GET is unaffected', async () => {
    const app = await guarded();
    const res = await app.inject({ method: 'GET', url: '/things', headers: { host: HOST } });
    expect(res.statusCode).toBe(200);
  });

  test('the GitHub webhook is exempt, with or without a query', async () => {
    const app = await guarded();
    for (const url of ['/webhooks/github', '/webhooks/github?x=1']) {
      const res = await app.inject({ method: 'POST', url, headers: { host: HOST } });
      expect(res.statusCode).toBe(200);
    }
  });

  test('X-Forwarded-Host is ignored unless the proxy is trusted', async () => {
    const forwarded = {
      host: 'api:3000',
      'x-forwarded-host': HOST,
      origin: `https://${HOST}`,
      'x-pra-request': '1',
    };

    const untrusted = await guarded();
    const rejected = await untrusted.inject({ method: 'POST', url: '/things', headers: forwarded });
    expect(rejected.statusCode).toBe(403);

    // `inject` comes from 127.0.0.1.
    const trusted = await guarded({ TRUST_PROXY: '127.0.0.1' });
    const passed = await trusted.inject({ method: 'POST', url: '/things', headers: forwarded });
    expect(passed.statusCode).toBe(200);
  });

  test('an untrusted X-Forwarded-Host cannot make a foreign Origin pass', async () => {
    const app = await guarded();
    const res = await app.inject({
      method: 'POST',
      url: '/things',
      headers: {
        host: HOST,
        'x-forwarded-host': 'evil.example',
        origin: 'https://evil.example',
        'x-pra-request': '1',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  test('the api loads the guard', async () => {
    const app = await build();

    const rejected = await app.inject({ method: 'POST', url: '/example', payload: { text: 'a' } });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toEqual(REJECTED);

    const passed = await app.inject({
      method: 'POST',
      url: '/example',
      headers: SAME_ORIGIN,
      payload: { text: 'a' },
    });
    expect(passed.statusCode).toBe(200);
  });
});

describe('TRUST_PROXY', () => {
  test('unset or empty trusts no proxy; otherwise a trimmed list', () => {
    expect(trustProxyFrom(undefined)).toBe(false);
    expect(trustProxyFrom(' ')).toBe(false);
    expect(trustProxyFrom('127.0.0.1, 10.0.0.0/8')).toEqual(['127.0.0.1', '10.0.0.0/8']);
  });
});
