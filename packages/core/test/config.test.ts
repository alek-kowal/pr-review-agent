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
  it('a broken field falls back alone, the good ones around it are kept, and the warning names it (P classify.test.ts:112)', () => {
    const raw = {
      ...WB_REPOSITORY_CONFIG,
      largePrLines: 'big',
      changeTypeRules: { usesExistingPaths: ['**/*.md'], oneWayPaths: 'deploy/**', sizeLines: 800 },
    };
    const { value, warnings } = parseWithFallback(RepositoryConfigSchema, REPO_DEFAULTS, raw);
    expect(value.changeTypeRules).toEqual({
      usesExistingPaths: ['**/*.md'],
      oneWayPaths: [],
      sizeLines: 800,
    });
    expect(value.largePrLines).toBe(REPO_DEFAULTS.largePrLines);
    expect(value.sensitivePatterns).toEqual(WB_REPOSITORY_CONFIG.sensitivePatterns);
    expect(value.slug).toBe('workflowbuilder');
    expect(warnings.map((w) => w.params)).toEqual([
      { field: 'changeTypeRules.oneWayPaths', issue: 'invalid_type' },
      { field: 'largePrLines', issue: 'invalid_type' },
    ]);
    // A nested object that is not an object at all falls back whole.
    const whole = parseWithFallback(RepositoryConfigSchema, REPO_DEFAULTS, {
      ...WB_REPOSITORY_CONFIG,
      changeTypeRules: 'none',
    });
    expect(whole.value.changeTypeRules).toEqual(REPO_DEFAULTS.changeTypeRules);
    expect(whole.warnings.map((w) => w.params)).toEqual([
      { field: 'changeTypeRules', issue: 'invalid_type' },
    ]);
  });

  it('a missing or unreadable settings value gives the defaults and says so once (P classify.test.ts:104, control.test.ts:37)', () => {
    for (const raw of ['not json', '', [], null, undefined]) {
      expect(parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, raw)).toEqual({
        value: DEFAULT_APP_SETTINGS,
        warnings: [{ code: 'config_not_object', params: {} }],
      });
    }
    expect(parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, {})).toEqual({
      value: DEFAULT_APP_SETTINGS,
      warnings: [],
    });
  });

  it('a valid file parses with no warnings, unknown keys dropped (P classify.test.ts:100)', () => {
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

  it('a broken level field falls back on its own, its siblings and the other levels stay (P levels.test.ts:66)', () => {
    const { value, warnings } = parseWithFallback(
      LevelOverridesSchema,
      {},
      {
        1: { maxFindings: 'four', maxQuestions: 1 },
        2: { models: { reviewer: '--dangerous', verifier: 'claude-haiku-5-5' } },
        3: 'yes',
        5: { autofixMaxPatches: 1 },
      },
    );
    expect(value).toEqual({
      1: { maxQuestions: 1 },
      2: { models: { verifier: 'claude-haiku-5-5' } },
      5: { autofixMaxPatches: 1 },
    });
    expect(warnings.map((w) => w.params)).toEqual([
      { field: '1.maxFindings', issue: 'invalid_type' },
      { field: '2.models.reviewer', issue: 'custom' },
      { field: '3', issue: 'invalid_type' },
    ]);
    expect(resolveLevel(3, value).settings.maxQuestions).toBe(3);
    expect(resolveLevel(1, value).settings.maxQuestions).toBe(1);
    expect(resolveLevel(1, value).settings.maxFindings).toBe(4);
  });

  it('paused holds every review, even with the budget spent (P control.test.ts:53)', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, paused: true, pausedReason: 'release freeze' };
    expect(holdReason(settings, 0)).toEqual({ code: 'paused', params: { note: 'release freeze' } });
    expect(holdReason({ ...settings, dailyBudgetUsd: 1 }, 5)?.code).toBe('paused');
  });

  it('a reached daily budget holds reviews (P control.test.ts:53)', () => {
    const settings = { ...DEFAULT_APP_SETTINGS, dailyBudgetUsd: 50 };
    expect(holdReason(settings, 49.99)).toBeNull();
    expect(holdReason(settings, 50)).toEqual({
      code: 'budget_reached',
      params: { spentUsd: 50, budgetUsd: 50 },
    });
  });

  it('no budget or a zero budget never holds, and the defaults are not paused (P control.test.ts:53, control.test.ts:30)', () => {
    expect(DEFAULT_APP_SETTINGS.dailyBudgetUsd).toBeNull();
    expect(DEFAULT_APP_SETTINGS.paused).toBe(false);
    expect(holdReason(DEFAULT_APP_SETTINGS, 1_000_000)).toBeNull();
    expect(holdReason({ ...DEFAULT_APP_SETTINGS, dailyBudgetUsd: 0 }, 7.2)).toBeNull();
    const stored = parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, {
      dailyBudgetUsd: 0,
    });
    expect(stored.value.dailyBudgetUsd).toBeNull();
  });

  it('the model comes from the level override, then settings, then the default (P control.test.ts:105)', () => {
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

  it('an empty model value falls back (P control.test.ts:105)', () => {
    expect(modelFor({ models: { reviewer: '  ' } }, null, 'reviewer')).toMatchObject({
      model: 'claude-opus-5-5',
      source: 'default',
    });
  });

  it('a settings field of the wrong type falls back alone, the good fields stay (P control.test.ts:45)', () => {
    const { value, warnings } = parseWithFallback(AppSettingsSchema, DEFAULT_APP_SETTINGS, {
      paused: 'yes',
      dailyBudgetUsd: '5',
      agentSlots: 3,
      models: {
        reviewer: 'claude-opus-5-5',
        verifier: 7,
        implementer: '--dangerously-skip-permissions',
      },
    });
    expect(value).toEqual({
      ...DEFAULT_APP_SETTINGS,
      agentSlots: 3,
      models: { reviewer: 'claude-opus-5-5' },
    });
    expect(warnings.map((w) => w.params)).toEqual([
      { field: 'paused', issue: 'invalid_type' },
      { field: 'dailyBudgetUsd', issue: 'invalid_type' },
      { field: 'models.verifier', issue: 'invalid_type' },
      { field: 'models.implementer', issue: 'custom' },
    ]);
  });

  it('accepts the WB fixture and fills repository defaults', () => {
    expect(RepositoryConfigSchema.parse(WB_REPOSITORY_CONFIG)).toEqual(WB_REPOSITORY_CONFIG);
    expect(REPO_DEFAULTS).toMatchObject({
      defaultBranch: 'main',
      defaultLevel: 1,
      fetchCommand: null,
      installCommand: null,
      sensitivePatterns: [],
    });
    expect(DEFAULT_APP_SETTINGS).toEqual({
      paused: false,
      pausedReason: null,
      pausedBy: null,
      pausedAt: null,
      dailyBudgetUsd: null,
      agentSlots: 2,
      timeZone: 'Europe/Warsaw',
      models: {},
      afterRoundGithubComment: true,
    });
  });
});
