import { describe, expect, it } from 'vitest';
import { canPush, type PushablePatch, type PushTarget } from '../src/index.ts';

const BASE = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const patch = (overrides: Partial<PushablePatch> = {}): PushablePatch => ({
  status: 'ready',
  baseSha: BASE,
  files: 2,
  ...overrides,
});
const pr = (overrides: Partial<PushTarget> = {}): PushTarget => ({
  number: 265,
  fork: false,
  activeRun: null,
  ...overrides,
});

describe('canPush', () => {
  it('allows a ready patch on the head it was made on, with the right number', () => {
    expect(canPush(patch(), pr(), 265, BASE)).toEqual({ allowed: true });
  });

  it('refuses a wrong PR number', () => {
    expect(canPush(patch(), pr(), 256, BASE)).toEqual({
      allowed: false,
      reason: { code: 'pr_number_mismatch', params: { number: 265 } },
    });
  });

  it('refuses a patch that is not ready', () => {
    expect(canPush(patch({ status: 'pushed' }), pr(), 265, BASE)).toEqual({
      allowed: false,
      reason: { code: 'patch_not_ready', params: { status: 'pushed' } },
    });
  });

  it('refuses when the head moved, naming the new head', () => {
    expect(canPush(patch(), pr(), 265, MOVED)).toEqual({
      allowed: false,
      reason: { code: 'head_moved', params: { headSha: MOVED } },
    });
  });

  it('refuses while a run is active', () => {
    const activeRun = { kind: 'round', status: 'running' } as const;
    expect(canPush(patch(), pr({ activeRun }), 265, BASE)).toEqual({
      allowed: false,
      reason: { code: 'run_active', params: { kind: 'round', status: 'running' } },
    });
  });

  it('refuses a fork before anything else', () => {
    expect(canPush(patch({ status: 'pushed' }), pr({ fork: true }), 1, MOVED)).toEqual({
      allowed: false,
      reason: { code: 'fork_read_only', params: {} },
    });
  });

  it('refuses a patch whose files are all reverted', () => {
    expect(canPush(patch({ files: 0 }), pr(), 265, BASE)).toEqual({
      allowed: false,
      reason: { code: 'patch_empty', params: {} },
    });
  });
});
