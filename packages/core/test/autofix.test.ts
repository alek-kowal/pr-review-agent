import { describe, expect, it } from 'vitest';
import {
  autofixDecision,
  pushByItself,
  type AutofixInput,
  type PatchResult,
} from '../src/index.ts';
import { makeFinding } from './builders.ts';
import { WB_SENSITIVE_PATTERNS } from './fixtures/wb-config.ts';

const input = (overrides: Partial<AutofixInput> = {}): AutofixInput => ({
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
const HEAD = 'abc123';
const pr = { headSha: HEAD, sensitivePatterns: WB_SENSITIVE_PATTERNS };
const patch = (overrides: Partial<PatchResult> = {}): PatchResult => ({
  baseSha: HEAD,
  findingIds: ['a', 'b'],
  fixedFindingIds: ['a', 'b'],
  reproductions: { total: 2, passed: 2 },
  files: ['packages/sdk/src/edges/edge.ts'],
  ...overrides,
});
const codes = (reasons: { code: string }[]) => reasons.map((r) => r.code);

describe('autofix', () => {
  it('starts when every finding that needs work is confirmed with an obvious fix (P autofix.test.ts:54)', () => {
    const decision = autofixDecision(
      input({
        findings: [
          makeFinding({ id: 'a' }),
          makeFinding({ id: 'n', severity: 'nit' }),
          makeFinding({ id: 'r', verdict: 'refuted', remedy: null }),
          makeFinding({ id: 'd', decision: 'reject' }),
          makeFinding({ id: 'u', severity: 'nit', verdict: 'not_proven', remedy: null }),
        ],
      }),
    );
    expect(decision).toEqual({
      enabled: true,
      go: true,
      findingIds: ['a'],
      reasons: [{ code: 'autofix_conditions_met', params: { count: 1 } }],
    });
  });

  it('below level 5 it only says what it would do; level 6 acts too (P autofix.test.ts:88)', () => {
    const atFive = autofixDecision(input({ openQuestions: 1 }));
    const atThree = autofixDecision(input({ level: 3, openQuestions: 1 }));
    expect(atThree.enabled).toBe(false);
    expect(atThree.reasons).toEqual(atFive.reasons);
    expect(atThree.go).toBe(atFive.go);
    expect(autofixDecision(input({ level: 4 }))).toMatchObject({ enabled: false, go: true });
    expect(autofixDecision(input({ level: 6 }))).toMatchObject({ enabled: true, go: true });
  });

  it('with nothing to fix it says only that, even with open questions (P autofix.test.ts:88)', () => {
    const decision = autofixDecision(
      input({ openQuestions: 1, findings: [makeFinding({ severity: 'nit' })] }),
    );
    expect(decision).toEqual({
      enabled: true,
      go: false,
      findingIds: [],
      reasons: [{ code: 'nothing_to_fix', params: {} }],
    });
  });

  it('holds on unsure verdicts (P autofix.test.ts:67)', () => {
    const decision = autofixDecision(
      input({
        findings: [makeFinding({ verdict: 'not_proven' }), makeFinding({ verdict: 'unchecked' })],
      }),
    );
    expect(decision.go).toBe(false);
    expect(decision.reasons).toEqual([{ code: 'unsure_verdicts', params: { count: 2 } }]);
  });

  it('holds on open questions and on a fix that needs a decision or has none (P autofix.test.ts:67)', () => {
    const decision = autofixDecision(
      input({
        openQuestions: 2,
        findings: [makeFinding({ remedy: 'needs_decision' }), makeFinding({ remedy: null })],
      }),
    );
    expect(decision.reasons).toEqual([
      { code: 'open_questions', params: { count: 2 } },
      { code: 'fix_needs_decision', params: { count: 2 } },
    ]);
  });

  it('allows at most N automatic patches per chain (P autofix.test.ts:67)', () => {
    expect(autofixDecision(input({ autoPatchesInChain: 1 })).go).toBe(true);
    expect(autofixDecision(input({ autoPatchesInChain: 2 })).reasons).toEqual([
      { code: 'auto_patches_used', params: { used: 2, max: 2 } },
    ]);
    expect(autofixDecision(input({ autoPatchesInChain: 2, maxAutoPatches: 3 })).go).toBe(true);
  });

  it('never pushes a patch that touches a sensitive file (P autofix.test.ts:137)', () => {
    const result = pushByItself(
      patch({
        files: ['packages/sdk/src/edges/edge.ts', 'packages/temporal/src/workflow/heartbeat.ts'],
      }),
      pr,
    );
    expect(result).toEqual({
      go: false,
      reasons: [
        {
          code: 'patch_touches_sensitive',
          params: {
            path: 'packages/temporal/src/workflow/heartbeat.ts',
            pattern: 'packages/temporal/src/workflow/',
          },
        },
      ],
    });
  });

  it('pushes only when every finding is fixed, every reproduction passes and the head has not moved (P autofix.test.ts:137)', () => {
    expect(pushByItself(patch(), pr)).toEqual({
      go: true,
      reasons: [{ code: 'push_conditions_met', params: {} }],
    });
    const partial = pushByItself(
      patch({ fixedFindingIds: ['a'], reproductions: { total: 2, passed: 1 } }),
      pr,
    );
    expect(partial.go).toBe(false);
    expect(partial.reasons).toEqual([
      { code: 'not_all_fixed', params: { fixed: 1, total: 2 } },
      { code: 'reproductions_fail', params: { failed: 1, total: 2 } },
    ]);
    expect(pushByItself(patch({ baseSha: 'old456' }), pr)).toEqual({
      go: false,
      reasons: [{ code: 'head_moved_since_patch', params: {} }],
    });
  });

  it('holds for a fork, a trial, a One-way door, pause, budget and new commits (P autofix.test.ts:67)', () => {
    const decision = autofixDecision(
      input({
        fork: true,
        trial: true,
        changeType: 'one_way_door',
        paused: true,
        budgetReached: true,
        commitsSinceReview: 2,
      }),
    );
    expect(codes(decision.reasons)).toEqual([
      'fork_read_only',
      'autofix_trial',
      'one_way_door_hold',
      'head_moved_since_review',
      'autofix_paused',
      'autofix_budget_reached',
    ]);
    expect(autofixDecision(input({ findings: [] })).reasons).toEqual([
      { code: 'nothing_to_fix', params: {} },
    ]);
  });

  it('counts a finding decided Implement and not resolved as work', () => {
    const decision = autofixDecision(
      input({ findings: [makeFinding({ id: 'i', severity: 'nit', decision: 'implement' })] }),
    );
    expect(decision).toMatchObject({ go: true, findingIds: ['i'] });
  });
});
