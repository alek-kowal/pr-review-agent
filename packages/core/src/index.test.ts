import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.ts';

describe('@pra/core', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@pra/core');
  });
});
