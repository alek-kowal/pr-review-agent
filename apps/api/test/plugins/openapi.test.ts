import { expect, test } from 'vitest';
import { build } from '../helper.ts';

test('GET /docs/json serves the OpenAPI document with the sample Zod route', async () => {
  const app = await build();

  const res = await app.inject({ url: '/docs/json' });

  expect(res.statusCode).toBe(200);
  const doc = res.json();
  expect(doc.openapi).toBe('3.1.0');
  expect(doc.info.title).toBe('PR Review Agent API');

  const echo = doc.paths['/example/'].post;
  expect(echo.requestBody.content['application/json'].schema).toMatchObject({
    type: 'object',
    properties: { text: { type: 'string', minLength: 1, maxLength: 200 } },
    required: ['text'],
  });
  expect(echo.responses['200'].content['application/json'].schema).toMatchObject({
    type: 'object',
    properties: { text: { type: 'string' }, length: { type: 'integer' } },
  });
  expect(doc.paths['/docs/json']).toBeUndefined();
});
