import { describe, expect, it } from 'vitest';
import { notifyText } from '../src/index.ts';

describe('notifyText', () => {
  const base = { author: 'Kasia', signer: 'Tomek', prNumber: 272 };

  it('names the author, the signer and both counts', () => {
    expect(notifyText({ ...base, worth: 2, notWorth: 1 })).toBe(
      '@Kasia: Tomek marked 2 findings as worth implementing and 1 finding as not worth it in PR #272',
    );
  });

  it('leaves out a zero count', () => {
    expect(notifyText({ ...base, worth: 1, notWorth: 0 })).toBe(
      '@Kasia: Tomek marked 1 finding as worth implementing in PR #272',
    );
    expect(notifyText({ ...base, worth: 0, notWorth: 3 })).toBe(
      '@Kasia: Tomek marked 3 findings as not worth it in PR #272',
    );
  });
});
