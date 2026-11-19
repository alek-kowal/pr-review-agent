import { describe, expect, it } from 'vitest';
import {
  autofixCheck,
  autofixMode,
  type AutofixInput,
  type AutofixPushInput,
  type PatchResult,
} from '../src/index.ts';
import { makeFinding } from './builders.ts';
import { WB_SENSITIVE_PATTERNS } from './fixtures/wb-config.ts';

const HEAD = 'abc123';
const start = (overrides: Partial<AutofixInput> = {}): AutofixInput => ({
  level: 5,
  fork: false,
  paused: false,
  budgetReached: false,
  changeType: 'changes_behaviour',
  findings: [makeFinding({ id: 'a' }), makeFinding({ id: 'b', severity: 'blocking' })],
  openQuestions: 0,
  autoPatchesInChain: 0,
  ...overrides,
});
const patch = (overrides: Partial<PatchResult> = {}): PatchResult => ({
  baseSha: HEAD,
  findingIds: ['a', 'b'],
  fixedFindingIds: ['a', 'b'],
  reproductions: { total: 2, passed: 2 },
  files: ['packages/sdk/src/edges/edge.ts'],
  ...overrides,
});
const push = (overrides: Partial<AutofixPushInput> = {}): AutofixPushInput => ({
  level: 5,
  fork: false,
  patch: patch(),
  headSha: HEAD,
  sensitivePatterns: WB_SENSITIVE_PATTERNS,
  autoPatchesInChain: 0,
  paused: false,
  budgetReached: false,
  ...overrides,
});
const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code);

describe('autofixCheck', () => {
  it('acts at level 5 and 6, writes the shadow at 3 and 4, and is off below', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => autofixMode(n as 1))).toEqual([
      'off',
      'off',
      'shadow',
      'shadow',
      'act',
      'act',
    ]);
    expect(autofixCheck('start', start())).toMatchObject({
      mode: 'act',
      allowed: true,
      reason: { code: 'autofix_conditions_met', params: { count: 2 } },
      findingIds: ['a', 'b'],
    });
    const shadow = autofixCheck('start', start({ level: 3 }));
    expect(shadow).toMatchObject({ mode: 'shadow', allowed: true });
    expect(autofixCheck('push', push({ level: 4 }))).toMatchObject({
      mode: 'shadow',
      allowed: true,
      reason: { code: 'push_conditions_met' },
    });
  });

  it('gives each failing start condition its reason code', () => {
    const held = autofixCheck(
      'start',
      start({
        openQuestions: 1,
        changeType: 'one_way_door',
        findings: [makeFinding({ id: 'a', verdict: 'not_proven', remedy: null })],
      }),
    );
    expect(held.allowed).toBe(false);
    expect(codes(held.reasons)).toEqual([
      'open_questions',
      'unsure_verdicts',
      'fix_needs_decision',
      'one_way_door_hold',
    ]);
    expect(held.reason).toEqual({ code: 'open_questions', params: { count: 1 } });
  });

  it('never pushes a patch that touches a sensitive file', () => {
    const files = ['packages/sdk/src/edges/edge.ts', '.github/workflows/ci.yml'];
    const held = autofixCheck('push', push({ patch: patch({ files }) }));
    expect(held.allowed).toBe(false);
    expect(held.reason.code).toBe('patch_touches_sensitive');
    expect(held.reason.params).toMatchObject({ path: '.github/workflows/ci.yml' });
  });

  it('gives each failing push condition its reason code', () => {
    const held = autofixCheck(
      'push',
      push({
        headSha: 'moved',
        patch: patch({ fixedFindingIds: ['a'], reproductions: { total: 2, passed: 1 } }),
      }),
    );
    expect(codes(held.reasons)).toEqual([
      'head_moved_since_patch',
      'not_all_fixed',
      'reproductions_fail',
    ]);
  });

  it('a third patch in one chain with N = 2 hits the cap, at start and at push', () => {
    expect(autofixCheck('start', start({ autoPatchesInChain: 1 })).allowed).toBe(true);
    const third = autofixCheck('start', start({ autoPatchesInChain: 2, maxAutoPatches: 2 }));
    expect(third.allowed).toBe(false);
    expect(third.reason).toEqual({ code: 'auto_patches_used', params: { used: 2, max: 2 } });

    expect(autofixCheck('push', push({ autoPatchesInChain: 1 })).allowed).toBe(true);
    const thirdPush = autofixCheck('push', push({ autoPatchesInChain: 2 }));
    expect(thirdPush.reason).toEqual({ code: 'auto_patches_used', params: { used: 2, max: 2 } });
    expect(autofixCheck('push', push({ autoPatchesInChain: 2, maxAutoPatches: 3 })).allowed).toBe(
      true,
    );
  });

  it('a fork never acts, at start or at push', () => {
    const atStart = autofixCheck('start', start({ fork: true }));
    expect(atStart).toMatchObject({ mode: 'act', allowed: false });
    expect(codes(atStart.reasons)).toContain('fork_read_only');
    const atPush = autofixCheck('push', push({ fork: true }));
    expect(atPush.allowed).toBe(false);
    expect(atPush.reason.code).toBe('fork_read_only');
  });

  it('a pause or a reached budget holds the push of a ready patch', () => {
    const paused = autofixCheck('push', push({ paused: true }));
    expect(paused).toMatchObject({ allowed: false, reason: { code: 'autofix_paused' } });
    const budget = autofixCheck('push', push({ budgetReached: true }));
    expect(budget).toMatchObject({ allowed: false, reason: { code: 'autofix_budget_reached' } });
  });
});
