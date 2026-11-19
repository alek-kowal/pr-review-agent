import { describe, expect, it } from 'vitest';
import {
  AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
  LevelOverridesSchema,
  RepositoryConfigSchema,
  holdReason,
  modelFor,
  parseWithFallback,
  resolveLevel,
  validModelName,
  type RepositoryConfig,
} from '../src/index.ts';
import { WB_REPOSITORY_CONFIG } from './fixtures/wb-config.ts';

const REPO_DEFAULTS: RepositoryConfig = RepositoryConfigSchema.parse({
  slug: 'fallback',
  githubFullName: 'org/fallback',
});

describe('config resilience', () => {
  it('a broken repository field falls back alone, with a warning naming it (P classify.test.ts:100)', () => {
    const raw = {
      ...WB_REPOSITORY_CONFIG,
      changeTypeRules: { usesExistingPaths: ['**/*.md'], oneWayPaths: 'deploy/**', sizeLines: 800 },
    };
    const { value, warnings } = parseWithFallback(RepositoryConfigSchema, REPO_DEFAULTS, raw);
    expect(value.changeTypeRules).toEqual(REPO_DEFAULTS.changeTypeRules);
    expect(value.sensitivePatterns).toEqual(WB_REPOSITORY_CONFIG.sensitivePatterns);
    expect(value.slug).toBe('workflowbuilder');
    expect(warnings).toEqual([
      { code: 'config_field_invalid', params: { field: 'changeTypeRules', issue: 'invalid_type' } },
    ]);
  });

  it('a missing or unreadable settings value gives the defaults (P classify.test.ts:104)', () => {
    const { value, warnings } = parseWithFallback(
      AppSettingsSchema,
      DEFAULT_APP_SETTINGS,
      'not json',
    );
    expect(value).toEqual(DEFAULT_APP_SETTINGS);
    expect(warnings).toEqual([{ code: 'config_not_object', params: {} }]);
    expect(parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, {})).toEqual({
      value: DEFAULT_APP_SETTINGS,
      warnings: [],
    });
  });

  it('a valid file parses with no warnings, unknown keys dropped (P classify.test.ts:112)', () => {
    const { value, warnings } = parseWithFallback(RepositoryConfigSchema, REPO_DEFAULTS, {
      ...WB_REPOSITORY_CONFIG,
      legacyTier: 'composes',
    });
    expect(warnings).toEqual([]);
    expect(value).toEqual(WB_REPOSITORY_CONFIG);
    expect(value).not.toHaveProperty('legacyTier');
  });

  it('model names are validated against flag injection (P classify.test.ts:273)', () => {
    expect(validModelName('claude-opus-5-5')).toBe(true);
    expect(validModelName('us.anthropic.claude-sonnet-5-5')).toBe(true);
    expect(validModelName('claude-opus-5-5[1m]')).toBe(true);
    expect(validModelName('--dangerously-skip-permissions')).toBe(false);
    expect(validModelName('-p')).toBe(false);
    expect(validModelName('claude-opus-5-5 --allowedTools Bash')).toBe(false);
    expect(validModelName('claude;rm -rf /')).toBe(false);
    expect(validModelName('')).toBe(false);
  });

  it('a broken level falls back on its own, the others keep their overrides (P levels.test.ts:66)', () => {
    const { value, warnings } = parseWithFallback(
      LevelOverridesSchema,
      {},
      { 1: { maxFindings: 'four' }, 2: { maxQuestions: 1 }, 5: { autofixMaxPatches: 1 } },
    );
    expect(value).toEqual({ 2: { maxQuestions: 1 }, 5: { autofixMaxPatches: 1 } });
    expect(warnings).toEqual([
      { code: 'config_field_invalid', params: { field: '1', issue: 'invalid_type' } },
    ]);
    expect(resolveLevel(3, value).settings.maxQuestions).toBe(1);
    expect(resolveLevel(1, value).settings.maxFindings).toBe(4);
  });

  it('paused holds every review (P control.test.ts:30)', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, paused: true, pausedReason: 'release freeze' };
    expect(holdReason(settings, 0)).toEqual({ code: 'paused', params: { note: 'release freeze' } });
  });

  it('a reached daily budget holds reviews (P control.test.ts:37)', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, dailyBudgetUsd: 50 };
    expect(holdReason(settings, 49.99)).toBeNull();
    expect(holdReason(settings, 50)).toEqual({
      code: 'budget_reached',
      params: { spentUsd: 50, budgetUsd: 50 },
    });
  });

  it('no budget set never holds (P control.test.ts:45)', () => {
    expect(DEFAULT_APP_SETTINGS.dailyBudgetUsd).toBeNull();
    expect(holdReason(DEFAULT_APP_SETTINGS, 1_000_000)).toBeNull();
  });

  it('the model comes from the level override, then settings, then the default (P control.test.ts:53)', () => {
    const settings = { models: { reviewer: 'claude-sonnet-5-5', verifier: 'claude-haiku-5-5' } };
    const level = resolveLevel(3, { 2: { models: { reviewer: 'claude-haiku-5-5' } } });
    expect(modelFor(settings, level, 'reviewer')).toEqual({
      model: 'claude-haiku-5-5',
      source: 'level',
      level: 2,
    });
    expect(modelFor(settings, level, 'verifier')).toEqual({
      model: 'claude-haiku-5-5',
      source: 'settings',
      level: null,
    });
    expect(modelFor(settings, level, 'judge')).toEqual({
      model: 'claude-haiku-5-5',
      source: 'default',
      level: null,
    });
    expect(modelFor({ models: {} }, null, 'reviewer').model).toBe('claude-opus-5-5');
  });

  it('an empty model value falls back, and broken settings fall back field by field (P control.test.ts:105)', () => {
    expect(modelFor({ models: { reviewer: '  ' } }, null, 'reviewer')).toMatchObject({
      model: 'claude-opus-5-5',
      source: 'default',
    });
    const { value, warnings } = parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, {
      paused: true,
      agentSlots: 0,
      models: { reviewer: '--dangerously-skip-permissions' },
    });
    expect(value).toEqual({ ...DEFAULT_APP_SETTINGS, paused: true });
    expect(warnings.map((w) => w.params)).toEqual([
      { field: 'agentSlots', issue: 'too_small' },
      { field: 'models', issue: 'custom' },
    ]);
  });

  it('accepts the WB fixture and fills repository defaults', () => {
    expect(RepositoryConfigSchema.parse(WB_REPOSITORY_CONFIG)).toEqual(WB_REPOSITORY_CONFIG);
    expect(REPO_DEFAULTS).toMatchObject({
      defaultBranch: 'main',
      defaultLevel: 1,
      installCommand: null,
      sensitivePatterns: [],
    });
    expect(DEFAULT_APP_SETTINGS).toEqual({
      paused: false,
      pausedReason: null,
      dailyBudgetUsd: null,
      agentSlots: 2,
      models: {},
      afterRoundGithubComment: true,
    });
  });
});
