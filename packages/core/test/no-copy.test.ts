/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Core returns reason codes, never prose. Polish text in src means a P status string was ported
// as copy instead of becoming a code.
const POLISH = /[ĄąĆćĘęŁłŃńÓóŚśŹźŻż]/u;

const sources = import.meta.glob<string>('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('no copy in packages/core/src', () => {
  it('scans every source file', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it.each(Object.entries(sources))('%s has no Polish text', (_path, text) => {
    const hits = text.split('\n').filter((line) => POLISH.test(line));
    expect(hits).toEqual([]);
  });

  it('detects Polish diacritics', () => {
    expect(POLISH.test('Zażółć gęślą jaźń')).toBe(true);
    expect(POLISH.test('Nit is optional')).toBe(false);
  });
});
