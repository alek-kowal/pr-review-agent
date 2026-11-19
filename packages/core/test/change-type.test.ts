import { describe, expect, it } from 'vitest';
import {
  changedLines,
  classifyChange,
  limitsFor,
  needsPerson,
  raiseChangeType,
} from '../src/index.ts';
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
  it('a sensitive file makes the change a One-way door, however small (P classify.test.ts:40)', () => {
    const result = classify(['README.md', 'apps/backend/drizzle/0007_add_runs.sql'], diffOf(2));
    expect(result.changeType).toBe('one_way_door');
    expect(result.reason).toEqual({
      code: 'sensitive_one_way',
      params: {
        path: 'apps/backend/drizzle/0007_add_runs.sql',
        pattern: 'apps/backend/drizzle/',
        reason: 'Database migrations cannot be undone after deploy.',
        files: 1,
      },
    });
    expect(classify(['.github/workflows/release.yml']).reason).toMatchObject({
      code: 'sensitive_one_way',
      params: { pattern: '.github/workflows/' },
    });
  });

  it('a one-way path makes the change a One-way door and a person still gets it when a lower type is forced (P classify.test.ts:49)', () => {
    const result = classify(['apps/web/src/page.tsx', 'packages/types/src/index.ts']);
    expect(result.changeType).toBe('one_way_door');
    expect(result.reason).toEqual({
      code: 'path_one_way',
      params: { path: 'packages/types/src/index.ts', files: 1 },
    });
    const forced = raiseChangeType(result.changeType, null, 'changes_behaviour');
    expect(needsPerson(forced.changeType, forced.rulesPicked)).toEqual({
      needed: true,
      reason: { code: 'one_way_rules_need_person', params: { forced: 'changes_behaviour' } },
    });
    const without = classifyChange({
      files: ['packages/types/src/index.ts'],
      diff: diffOf(10),
      rules: { ...WB_CHANGE_TYPE_RULES, oneWayPaths: [] },
    });
    expect(without.changeType).toBe('changes_behaviour');
  });

  it('docs, tests and changesets only use existing parts (P classify.test.ts:58)', () => {
    const result = classify([
      'apps/docs/guide/edges.md',
      'packages/sdk/src/edge.test.ts',
      'packages/ui/src/__tests__/marker.tsx',
      '.changeset/brave-edges.md',
      'README.mdx',
    ]);
    expect(result.changeType).toBe('uses_existing');
    expect(result.reason).toEqual({ code: 'paths_uses_existing', params: { files: 5 } });
  });

  it('code outside the "uses existing" paths changes behaviour even for one line; a test next to it does not count (P classify.test.ts:72)', () => {
    const result = classify(
      ['packages/sdk/src/edges/edge.ts', 'packages/sdk/src/edges/edge.test.ts'],
      diffOf(1),
    );
    expect(result.changeType).toBe('changes_behaviour');
    expect(result.reason).toEqual({
      code: 'paths_change_behaviour',
      params: { path: 'packages/sdk/src/edges/edge.ts', files: 1, total: 2 },
    });
  });

  it('a change above the size threshold is at least Changes behaviour, docs only included (P classify.test.ts:80)', () => {
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

  it('counts added and removed lines, not file headers or context (P classify.test.ts:95)', () => {
    expect(changedLines(diffOf(3, 2))).toBe(5);
    expect(changedLines('')).toBe(0);
    const p = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,2 +1,2 @@'];
    expect(changedLines([...p, ' same', '-old', '+new', '+-- a comment'].join('\n'))).toBe(3);
  });

  it('a type forced by a person wins, still reports the rules pick, and takes its own limits (P classify.test.ts:86)', () => {
    const forced = raiseChangeType('changes_behaviour', null, 'uses_existing');
    expect(forced).toEqual({
      changeType: 'uses_existing',
      reason: {
        code: 'forced_by_person',
        params: { forced: 'uses_existing', rules: 'changes_behaviour' },
      },
      rulesPicked: 'changes_behaviour',
    });
    expect(limitsFor({}, forced.changeType).maxFindings).toBe(3);
  });

  it('the judge may raise the type, and a raise to a One-way door needs a person (P classify.test.ts:249)', () => {
    expect(raiseChangeType('uses_existing', 'changes_behaviour', null)).toEqual({
      changeType: 'changes_behaviour',
      reason: { code: 'judge_raised', params: { from: 'uses_existing', to: 'changes_behaviour' } },
      rulesPicked: 'uses_existing',
    });
    expect(needsPerson('changes_behaviour', 'uses_existing').needed).toBe(false);
    const raised = raiseChangeType('uses_existing', 'one_way_door', null);
    expect(raised.changeType).toBe('one_way_door');
    expect(needsPerson(raised.changeType, raised.rulesPicked)).toEqual({
      needed: true,
      reason: { code: 'one_way_needs_person', params: {} },
    });
  });

  it('the judge may never lower the type and has no say over a forced one (P classify.test.ts:262)', () => {
    expect(raiseChangeType('changes_behaviour', 'uses_existing', null)).toEqual({
      changeType: 'changes_behaviour',
      reason: {
        code: 'judge_cannot_lower',
        params: { judged: 'uses_existing', kept: 'changes_behaviour' },
      },
      rulesPicked: 'changes_behaviour',
    });
    expect(raiseChangeType('uses_existing', 'one_way_door', 'uses_existing').changeType).toBe(
      'uses_existing',
    );
    expect(raiseChangeType('changes_behaviour', null, null).reason).toEqual({
      code: 'rules_floor',
      params: { changeType: 'changes_behaviour' },
    });
    expect(raiseChangeType('changes_behaviour', 'changes_behaviour', null).reason).toEqual({
      code: 'judge_agreed',
      params: { changeType: 'changes_behaviour' },
    });
  });

  it('a One-way door always needs a person, a forced one included', () => {
    expect(needsPerson('one_way_door')).toEqual({
      needed: true,
      reason: { code: 'one_way_needs_person', params: {} },
    });
    expect(needsPerson('one_way_door', 'uses_existing').needed).toBe(true);
    expect(needsPerson('changes_behaviour').needed).toBe(false);
    expect(needsPerson('uses_existing')).toEqual({
      needed: false,
      reason: { code: 'change_type_no_person', params: { changeType: 'uses_existing' } },
    });
  });

  it('matches WB patterns with gitignore-style anchoring', () => {
    expect(classify(['packages/types/src/index.ts']).reason.code).toBe('path_one_way');
    expect(classify(['packages/ui/src/nested/index.ts']).changeType).toBe('changes_behaviour');
    expect(classify(['apps/sdk-demo/CLAUDE.md']).reason).toMatchObject({
      code: 'sensitive_one_way',
      params: { path: 'apps/sdk-demo/CLAUDE.md', pattern: 'CLAUDE.md' },
    });
    expect(classify(['packages/temporal/src/workflow/heartbeat.ts']).changeType).toBe(
      'one_way_door',
    );
    expect(classify(['apps/backend/deploy/notes.txt']).changeType).toBe('changes_behaviour');
  });
});
