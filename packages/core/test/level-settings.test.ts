import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODELS,
  LevelSettingsPatchSchema,
  RoleModelsSchema,
  invalidRunModel,
  levelAdds,
  levelModelOverrides,
  resolveLevelSettings,
  validModelName,
} from '../src/index.ts';

describe('level settings (S-21-T1)', () => {
  it('level 4 inherits level 3’s timeout until it has its own', () => {
    const overrides = { 3: { stageTimeoutMinutes: 12 } };
    const inherited = resolveLevelSettings(4, overrides);
    expect(inherited.settings.stageTimeoutMinutes).toBe(12);
    expect(inherited.origins.stageTimeoutMinutes).toEqual({ level: 3, source: 'override' });
    expect(inherited.own).toEqual({});

    const own = resolveLevelSettings(4, { ...overrides, 4: { stageTimeoutMinutes: 45 } });
    expect(own.settings.stageTimeoutMinutes).toBe(45);
    expect(own.origins.stageTimeoutMinutes).toEqual({ level: 4, source: 'override' });
    expect(own.own).toEqual({ stageTimeoutMinutes: 45 });

    expect(resolveLevelSettings(2, overrides).settings.stageTimeoutMinutes).toBe(30);
  });

  it('most findings above 7 is rejected', () => {
    expect(LevelSettingsPatchSchema.safeParse({ maxFindings: 7 }).success).toBe(true);
    expect(LevelSettingsPatchSchema.safeParse({ maxFindings: 8 }).success).toBe(false);
  });

  it('`--model=x` and names with spaces are rejected', () => {
    for (const bad of ['--model=x', 'claude opus', ' ', 'claude-opus-5-5 --x']) {
      expect(validModelName(bad)).toBe(false);
    }
    const roles = { ...DEFAULT_MODELS, verifier: '--model=x' };
    const parsed = RoleModelsSchema.safeParse(roles);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['verifier'],
      message: 'invalid_model_name',
    });
    expect(
      LevelSettingsPatchSchema.safeParse({ models: { reviewer: 'claude opus' } }).success,
    ).toBe(false);
  });

  it('a level 6 model override beats the role default', () => {
    const roleModels = { ...DEFAULT_MODELS, reviewer: 'claude-sonnet-5-5' };
    const overrides = { 6: { models: { reviewer: 'claude-opus-5-5' } } };
    expect(resolveLevelSettings(6, overrides, roleModels).models.reviewer).toEqual({
      model: 'claude-opus-5-5',
      source: 'level',
      level: 6,
    });
    expect(resolveLevelSettings(5, overrides, roleModels).models.reviewer).toEqual({
      model: 'claude-sonnet-5-5',
      source: 'settings',
      level: null,
    });
    expect(resolveLevelSettings(1, {}, {}).models.analyst.model).toBe('claude-sonnet-5-5');
    expect(levelModelOverrides(overrides)).toEqual([
      { level: 6, role: 'reviewer', model: 'claude-opus-5-5' },
    ]);
  });

  it('the ladder says what each level adds, and level 5 caps patches at 2', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => levelAdds(n as 1))).toEqual([
      ['review'],
      ['checks', 'task', 'change_type'],
      ['verify'],
      ['implement'],
      ['autofix'],
      ['learning'],
    ]);
    expect(resolveLevelSettings(5).settings.autofixMaxPatches).toBe(2);
    expect(resolveLevelSettings(4).settings.autofixMaxPatches).toBeNull();
  });

  it('an invalid stored model is kept on the run so the run fails, not silently swapped', () => {
    const models = resolveLevelSettings(3, {}, { verifier: 'bad name' }).models;
    expect(models.verifier.model).toBe('bad name');
    expect(invalidRunModel(models)).toEqual({
      code: 'model_invalid',
      params: { role: 'verifier', model: 'bad name' },
    });
    expect(invalidRunModel(resolveLevelSettings(3).models)).toBeNull();
  });
});
