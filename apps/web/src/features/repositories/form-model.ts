// The repository form: RepositoryConfig (minus slug and full name) flattened into one field per
// row of the save dialog, and back.
import {
  DEFAULT_CHANGE_TYPE_RULES,
  DEFAULT_LARGE_PR_LINES,
  isValidGlob,
  isValidTaskIdPattern,
  LEVEL_NUMBERS,
  type LevelNumber,
} from '@pra/core';
import type { SettingsField } from '@/features/settings/use-settings-form.ts';
import type { RepositorySettings } from '@/lib/api-types.ts';

export type SensitiveRow = { pattern: string; reason: string };
export type PathRule = 'usesExisting' | 'oneWay';
export type ChangeTypeRow = { pattern: string; rule: PathRule };

/** What the form edits. Number fields hold their text, so a cleared input stays cleared. */
export type RepositoryForm = {
  defaultBranch: string;
  /** Null: the global default level. */
  defaultLevel: LevelNumber | null;
  fetchCommand: string;
  installCommand: string;
  largePrLines: string;
  clickupEnabled: boolean;
  clickupWorkspaceId: string;
  clickupSpaceId: string;
  clickupFollowUpListId: string;
  clickupTaskIdPattern: string;
  sensitivePatterns: SensitiveRow[];
  changeTypePaths: ChangeTypeRow[];
  changeTypeSizeLines: string;
};

/** The settings a newly connected repository starts from (the api's defaults). */
export function newRepositorySettings(defaultBranch: string): RepositorySettings {
  return {
    defaultBranch,
    defaultLevel: null,
    fetchCommand: null,
    installCommand: null,
    clickup: null,
    sensitivePatterns: [],
    changeTypeRules: DEFAULT_CHANGE_TYPE_RULES,
    largePrLines: DEFAULT_LARGE_PR_LINES,
  };
}

export function toForm(config: RepositorySettings): RepositoryForm {
  const rules = config.changeTypeRules;
  return {
    defaultBranch: config.defaultBranch,
    defaultLevel: config.defaultLevel,
    fetchCommand: config.fetchCommand ?? '',
    installCommand: config.installCommand ?? '',
    largePrLines: String(config.largePrLines),
    clickupEnabled: config.clickup !== null,
    clickupWorkspaceId: config.clickup?.workspaceId ?? '',
    clickupSpaceId: config.clickup?.spaceId ?? '',
    clickupFollowUpListId: config.clickup?.followUpListId ?? '',
    clickupTaskIdPattern: config.clickup?.taskIdPattern ?? '',
    sensitivePatterns: config.sensitivePatterns.map(({ pattern, reason }) => ({ pattern, reason })),
    changeTypePaths: [
      ...rules.usesExistingPaths.map((pattern) => ({ pattern, rule: 'usesExisting' as const })),
      ...rules.oneWayPaths.map((pattern) => ({ pattern, rule: 'oneWay' as const })),
    ],
    changeTypeSizeLines: String(rules.sizeLines),
  };
}

const text = (value: string) => value.trim();
const orNull = (value: string) => text(value) || null;

/** The config the api takes; call it only on a form without errors. */
export function toSettings(form: RepositoryForm): RepositorySettings {
  const paths = (rule: PathRule) =>
    form.changeTypePaths.filter((row) => row.rule === rule).map((row) => text(row.pattern));
  return {
    defaultBranch: text(form.defaultBranch),
    defaultLevel: form.defaultLevel,
    fetchCommand: orNull(form.fetchCommand),
    installCommand: orNull(form.installCommand),
    largePrLines: Number(form.largePrLines),
    clickup: form.clickupEnabled
      ? {
          workspaceId: text(form.clickupWorkspaceId),
          spaceId: orNull(form.clickupSpaceId),
          followUpListId: orNull(form.clickupFollowUpListId),
          taskIdPattern: text(form.clickupTaskIdPattern),
        }
      : null,
    sensitivePatterns: form.sensitivePatterns.map((row) => ({
      pattern: text(row.pattern),
      reason: text(row.reason),
    })),
    changeTypeRules: {
      usesExistingPaths: paths('usesExisting'),
      oneWayPaths: paths('oneWay'),
      sizeLines: Number(form.changeTypeSizeLines),
    },
  };
}

/** Why a field cannot be saved, as a key of `copy.repositories.errors`. */
export type FormError =
  'required' | 'positiveWhole' | 'invalidGlob' | 'reasonRequired' | 'invalidTaskIdPattern';

/**
 * The form's errors by field: a scalar field by its key, a table cell as
 * `sensitivePatterns.<row>.pattern` or `changeTypePaths.<row>.pattern`. Empty when it can be saved.
 */
export function validate(form: RepositoryForm): Record<string, FormError> {
  const errors: Record<string, FormError> = {};
  const positiveWhole = (key: keyof RepositoryForm, value: string) => {
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n <= 0) errors[key] = 'positiveWhole';
  };
  const glob = (key: string, value: string) => {
    if (!text(value)) errors[key] = 'required';
    else if (!isValidGlob(text(value))) errors[key] = 'invalidGlob';
  };

  if (!text(form.defaultBranch)) errors.defaultBranch = 'required';
  if (form.defaultLevel !== null && !LEVEL_NUMBERS.includes(form.defaultLevel)) {
    errors.defaultLevel = 'required';
  }
  positiveWhole('largePrLines', form.largePrLines);
  positiveWhole('changeTypeSizeLines', form.changeTypeSizeLines);
  if (form.clickupEnabled) {
    if (!text(form.clickupWorkspaceId)) errors.clickupWorkspaceId = 'required';
    if (!text(form.clickupTaskIdPattern)) errors.clickupTaskIdPattern = 'required';
    else if (!isValidTaskIdPattern(text(form.clickupTaskIdPattern))) {
      errors.clickupTaskIdPattern = 'invalidTaskIdPattern';
    }
  }
  form.sensitivePatterns.forEach((row, i) => {
    glob(`sensitivePatterns.${i}.pattern`, row.pattern);
    if (!text(row.reason)) errors[`sensitivePatterns.${i}.reason`] = 'reasonRequired';
  });
  form.changeTypePaths.forEach((row, i) => glob(`changeTypePaths.${i}.pattern`, row.pattern));
  return errors;
}

/** The save dialog's rows: one per field, in page order. */
export function repositoryFields(t: {
  fields: Record<keyof RepositoryForm, string>;
  levelOrGlobal: (n: number | null) => string;
  on: string;
  off: string;
  short: Record<PathRule, string>;
}): SettingsField<RepositoryForm>[] {
  const field = (
    key: keyof RepositoryForm,
    format?: (value: RepositoryForm[keyof RepositoryForm]) => string,
  ): SettingsField<RepositoryForm> => ({ key, label: t.fields[key], ...(format && { format }) });
  return [
    field('defaultLevel', (v) => t.levelOrGlobal(v as number | null)),
    field('defaultBranch'),
    field('fetchCommand'),
    field('installCommand'),
    field('largePrLines'),
    field('clickupEnabled', (v) => (v ? t.on : t.off)),
    field('clickupWorkspaceId'),
    field('clickupSpaceId'),
    field('clickupFollowUpListId'),
    field('clickupTaskIdPattern'),
    field('sensitivePatterns', (v) =>
      (v as SensitiveRow[]).map((row) => `${row.pattern} (${row.reason})`).join('; '),
    ),
    field('changeTypePaths', (v) =>
      (['usesExisting', 'oneWay'] as const)
        .map((rule) => {
          const paths = (v as ChangeTypeRow[]).filter((row) => row.rule === rule);
          return paths.length ? `${t.short[rule]}: ${paths.map((r) => r.pattern).join(', ')}` : '';
        })
        .filter(Boolean)
        .join(' · '),
    ),
    field('changeTypeSizeLines'),
  ];
}
