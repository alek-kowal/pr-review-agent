import Fastify from 'fastify';
import { expect, test } from 'vitest';
import Support from '../../src/plugins/support.ts';

test('support works standalone', async () => {
  const fastify = Fastify();
  void fastify.register(Support);
  await fastify.ready();

  expect(fastify.someSupport()).toBe('hugs');
});
