import { describe, expect, it } from 'vitest';
import { freezeLevel, resolveLevel, stagesFor, type LevelOverrides } from '../src/index.ts';

const onStages = (n: 1 | 2 | 3 | 4 | 5 | 6) =>
  stagesFor(n, 'full')
    .filter((s) => !s.off)
    .map((s) => s.key);

describe('review levels', () => {
  it('each level adds its stages, a higher level includes everything below (P levels.test.ts:26)', () => {
    expect(onStages(1)).toEqual(['review']);
    expect(onStages(2)).toEqual(['checks', 'task', 'change_type', 'review']);
    expect(onStages(3)).toEqual(['checks', 'task', 'change_type', 'review', 'verify']);
    expect(onStages(6)).toEqual(onStages(3));
    expect(resolveLevel(4).features).toEqual({ implement: true, autofix: false, learning: false });
    expect(resolveLevel(5).features).toEqual({ implement: true, autofix: true, learning: false });
  });

  it('inherits from the level below and records where each value came from (P levels.test.ts:50)', () => {
    const level = resolveLevel(3, { 1: { maxFindings: 5 }, 3: { stageTimeoutMinutes: 45 } });
    expect(level.settings).toEqual({
      brief: null,
      maxFindings: 7,
      maxQuestions: 3,
      stageTimeoutMinutes: 45,
      autofixMaxPatches: null,
    });
    expect(level.origins.settings).toEqual({
      brief: { level: 1, source: 'built_in' },
      maxFindings: { level: 2, source: 'built_in' },
      maxQuestions: { level: 2, source: 'built_in' },
      stageTimeoutMinutes: { level: 3, source: 'override' },
      autofixMaxPatches: { level: 1, source: 'built_in' },
    });
    expect(resolveLevel(1, { 1: { maxFindings: 5 } }).settings.maxFindings).toBe(5);
  });

  it('a frozen level is a snapshot that later setting changes do not touch (P levels.test.ts:127)', () => {
    const overrides: LevelOverrides = { 3: { maxFindings: 5 } };
    const frozen = freezeLevel(resolveLevel(3, overrides));
    overrides[3] = { maxFindings: 2 };
    expect(frozen.settings.maxFindings).toBe(5);
    expect(Object.isFrozen(frozen.settings)).toBe(true);
    expect(JSON.parse(JSON.stringify(frozen))).toEqual(frozen);
    expect(() => {
      (frozen.settings as { maxFindings: number }).maxFindings = 1;
    }).toThrow(TypeError);
  });

  it('level 1 runs only Review and marks the rest off_at_level', () => {
    expect(stagesFor(1, 'full')).toEqual([
      {
        key: 'checks',
        off: true,
        reason: { code: 'off_at_level', params: { stage: 'checks', level: 1, onFrom: 2 } },
      },
      {
        key: 'task',
        off: true,
        reason: { code: 'off_at_level', params: { stage: 'task', level: 1, onFrom: 2 } },
      },
      {
        key: 'change_type',
        off: true,
        reason: { code: 'off_at_level', params: { stage: 'change_type', level: 1, onFrom: 2 } },
      },
      { key: 'review', off: false, reason: null },
      {
        key: 'verify',
        off: true,
        reason: { code: 'off_at_level', params: { stage: 'verify', level: 1, onFrom: 3 } },
      },
    ]);
  });

  it('level 2 adds Checks, Task and Change type; level 3 adds Verify', () => {
    expect(stagesFor(2, 'full').find((s) => s.key === 'verify')?.reason).toEqual({
      code: 'off_at_level',
      params: { stage: 'verify', level: 2, onFrom: 3 },
    });
    expect(stagesFor(resolveLevel(3), 'full').every((s) => !s.off)).toBe(true);
  });

  it('level 6 has every feature on', () => {
    const level = resolveLevel(6);
    expect(level.key).toBe('learning');
    expect(level.features).toEqual({ implement: true, autofix: true, learning: true });
    expect(Object.values(level.stages).every(Boolean)).toBe(true);
    expect(level.settings.autofixMaxPatches).toBe(2);
    expect(level.origins.settings.autofixMaxPatches).toEqual({ level: 5, source: 'built_in' });
  });

  it('an override set at level 2 is inherited by level 3 with origin 2, never by level 1 (P levels.test.ts:50)', () => {
    const level = resolveLevel(3, {
      2: { maxQuestions: 1, models: { reviewer: 'claude-sonnet-5-5', judge: '' } },
    });
    expect(level.settings.maxQuestions).toBe(1);
    expect(level.origins.settings.maxQuestions).toEqual({ level: 2, source: 'override' });
    expect(level.models).toEqual({ reviewer: 'claude-sonnet-5-5' });
    expect(level.origins.models).toEqual({ reviewer: { level: 2, source: 'override' } });
    expect(resolveLevel(2, { 3: { models: { verifier: 'claude-haiku-5-5' } } }).models).toEqual({});
  });

  it('fix-check rounds get their own stages', () => {
    expect(stagesFor(4, 'fix_check').map((s) => [s.key, s.off])).toEqual([
      ['checks', false],
      ['fix_diff', false],
      ['check_fixes', false],
      ['reproductions', false],
    ]);
    expect(stagesFor(1, 'fix_check')[0]?.off).toBe(true);
  });
});
