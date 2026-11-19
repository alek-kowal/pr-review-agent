// P-27: the pure parts of `pnpm sandbox:bench`.
import { describe, expect, test } from 'vitest';
import {
  benchFailed,
  formatReport,
  githubFullNameOf,
  memUsageBytes,
  parseBenchArgs,
} from '../src/bench/bench.ts';

describe('parseBenchArgs', () => {
  test('needs --repo; --runtime is runc or runsc', () => {
    expect(parseBenchArgs([])).toEqual({ ok: false, message: '--repo is required' });
    expect(parseBenchArgs(['--repo', '.', '--runtime', 'kata'])).toMatchObject({ ok: false });
    expect(parseBenchArgs(['--repo', '.', '--nope'])).toMatchObject({ ok: false });
    const parsed = parseBenchArgs(['--repo', '/srv/wb', '--runtime', 'runsc', '--fresh']);
    expect(parsed).toEqual({
      ok: true,
      args: {
        repo: '/srv/wb',
        runtime: 'runsc',
        slug: null,
        ref: null,
        fetch: null,
        install: null,
        check: null,
        fresh: true,
        keep: false,
      },
    });
  });
});

test.each([
  ['https://github.com/acme/widgets.git', 'acme/widgets'],
  ['https://github.com/acme/widgets', 'acme/widgets'],
  ['git@github.com:acme/widgets.git', 'acme/widgets'],
  ['/var/lib/pra/data/git/mirrors/acme/widgets.git', 'acme/widgets'],
  ['/home/alek/code/widgets', null],
])('githubFullNameOf(%s) = %s', (source, expected) => {
  expect(githubFullNameOf(source)).toBe(expected);
});

test('memUsageBytes reads docker stats values', () => {
  expect(memUsageBytes('812.4MiB / 2GiB')).toBe(Math.round(812.4 * 1024 ** 2));
  expect(memUsageBytes('1.5GiB / 2GiB')).toBe(Math.round(1.5 * 1024 ** 3));
  expect(memUsageBytes('512kB / 2GB')).toBe(512_000);
  expect(memUsageBytes('--')).toBeNull();
});

test('the report lists each step; a failed or timed-out container step fails the bench', () => {
  const steps = [
    { name: 'fetch', exitCode: 0, timedOut: false, wallMs: 123_000, peakBytes: 800 * 1024 ** 2 },
    { name: 'install', exitCode: null, timedOut: true, wallMs: 900_000, peakBytes: null },
    { name: 'store links (host)', exitCode: null, timedOut: false, wallMs: 4_100, peakBytes: null },
  ];
  const text = formatReport({ header: 'Runtime runc', steps, diskBytes: 30 * 1024 ** 2 });
  expect(text).toContain('fetch    0        2 min 03 s  800 MiB');
  expect(text).toContain('install  timeout  15 min 00 s -');
  expect(text).toContain('store links (host)  -  4.1 s');
  expect(text).toContain('disk used by fetch and install: 30 MiB');
  expect(benchFailed(steps)).toBe(true);
  expect(benchFailed([steps[0]!, steps[2]!])).toBe(false);
});
