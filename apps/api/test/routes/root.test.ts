import { expect, test } from 'vitest';
import { build } from '../helper.ts';

test('default root route', async () => {
  const app = await build();

  const res = await app.inject({
    url: '/',
  });
  expect(res.statusCode).toBe(200);
  expect(JSON.parse(res.payload)).toEqual({ root: true });
});
