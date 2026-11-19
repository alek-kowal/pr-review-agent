import { describe, expect, it } from 'vitest';
import { changedLines, classifyChange, needsPerson, raiseChangeType } from '../src/index.ts';
import { WB_CHANGE_TYPE_RULES, WB_SENSITIVE_PATTERNS } from './fixtures/wb-config.ts';

const diffOf = (added: number, removed = 0) =>
  [
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,1 @@',
    ...Array.from({ length: added }, (_, i) => `+added ${i}`),
    ...Array.from({ length: removed }, (_, i) => `-removed ${i}`),
    ' context',
  ].join('\n');

const classify = (files: string[], diff = diffOf(10)) =>
  classifyChange({
    files,
    diff,
    rules: WB_CHANGE_TYPE_RULES,
    sensitivePatterns: WB_SENSITIVE_PATTERNS,
  });

describe('change type', () => {
  it('a one-way path makes the change a One-way door (P classify.test.ts:40)', () => {
    const result = classify(['apps/web/src/page.tsx', 'apps/backend/drizzle/0007_add_runs.sql']);
    expect(result.changeType).toBe('one_way_door');
    expect(result.reason).toEqual({
      code: 'path_one_way',
      params: { path: 'apps/backend/drizzle/0007_add_runs.sql' },
    });
  });

  it('a sensitive pattern makes the change a One-way door (P classify.test.ts:49)', () => {
    const result = classify(['.github/workflows/release.yml']);
    expect(result.changeType).toBe('one_way_door');
    expect(result.reason).toEqual({
      code: 'sensitive_one_way',
      params: { path: '.github/workflows/release.yml', pattern: '.github/workflows/' },
    });
  });

  it('docs and tests only use existing parts (P classify.test.ts:58)', () => {
    const result = classify([
      'apps/docs/guide/edges.md',
      'packages/sdk/src/edge.test.ts',
      'packages/ui/src/marker.spec.tsx',
      'README.md',
    ]);
    expect(result.changeType).toBe('uses_existing');
    expect(result.reason).toEqual({ code: 'paths_uses_existing', params: { files: 4 } });
  });

  it('code outside the rules changes behaviour (P classify.test.ts:66)', () => {
    const result = classify(['README.md', 'packages/sdk/src/edges/edge.ts']);
    expect(result.changeType).toBe('changes_behaviour');
    expect(result.reason).toEqual({
      code: 'paths_change_behaviour',
      params: { path: 'packages/sdk/src/edges/edge.ts' },
    });
  });

  it('a change above the size threshold is at least Changes behaviour (P classify.test.ts:72)', () => {
    const result = classify(['apps/docs/guide/edges.md'], diffOf(700, 101));
    expect(result.changeType).toBe('changes_behaviour');
    expect(result.reason).toEqual({
      code: 'size_over_threshold',
      params: { lines: 801, threshold: 800 },
    });
    expect(classify(['apps/docs/guide/edges.md'], diffOf(700, 100)).changeType).toBe(
      'uses_existing',
    );
  });

  it('counts added and removed lines, not file headers or context (P classify.test.ts:80)', () => {
    expect(changedLines(diffOf(3, 2))).toBe(5);
    expect(changedLines('')).toBe(0);
    expect(changedLines('--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+--- not a header')).toBe(1);
  });

  it('the judge may raise the type (P classify.test.ts:86)', () => {
    expect(raiseChangeType('uses_existing', 'changes_behaviour', null)).toEqual({
      changeType: 'changes_behaviour',
      reason: { code: 'judge_raised', params: { from: 'uses_existing', to: 'changes_behaviour' } },
      rulesPicked: 'uses_existing',
    });
  });

  it('the judge may never lower the type (P classify.test.ts:95)', () => {
    expect(raiseChangeType('one_way_door', 'uses_existing', null)).toEqual({
      changeType: 'one_way_door',
      reason: {
        code: 'judge_cannot_lower',
        params: { judged: 'uses_existing', kept: 'one_way_door' },
      },
      rulesPicked: 'one_way_door',
    });
    expect(raiseChangeType('changes_behaviour', null, null).reason).toEqual({
      code: 'rules_floor',
      params: { changeType: 'changes_behaviour' },
    });
  });

  it('a type forced by a person wins and still reports the rules pick (P classify.test.ts:249)', () => {
    expect(raiseChangeType('one_way_door', 'one_way_door', 'uses_existing')).toEqual({
      changeType: 'uses_existing',
      reason: {
        code: 'forced_by_person',
        params: { forced: 'uses_existing', rules: 'one_way_door' },
      },
      rulesPicked: 'one_way_door',
    });
  });

  it('a One-way door always needs a person (P classify.test.ts:262)', () => {
    expect(needsPerson('one_way_door')).toEqual({
      needed: true,
      reason: { code: 'one_way_needs_person', params: {} },
    });
    expect(needsPerson('changes_behaviour').needed).toBe(false);
    expect(needsPerson('uses_existing').needed).toBe(false);
  });

  it('matches WB patterns with gitignore-style anchoring', () => {
    expect(classify(['packages/ui/src/index.ts']).reason.code).toBe('path_one_way');
    expect(classify(['packages/ui/src/nested/index.ts']).changeType).toBe('changes_behaviour');
    expect(classify(['apps/sdk-demo/CLAUDE.md']).reason).toEqual({
      code: 'sensitive_one_way',
      params: { path: 'apps/sdk-demo/CLAUDE.md', pattern: 'CLAUDE.md' },
    });
    expect(classify(['packages/temporal/src/workflow/heartbeat.ts']).changeType).toBe(
      'one_way_door',
    );
  });
});
