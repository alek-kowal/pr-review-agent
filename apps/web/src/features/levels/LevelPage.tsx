import {
  AGENT_ROLES,
  LEVEL_NUMBERS,
  LevelSettingsPatchSchema,
  resolveLevelSettings,
  validModelName,
  type LevelNumber,
  type LevelOverrides,
} from '@pra/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group.tsx';
import { copy } from '@/copy/index.ts';
import { modelsQuery } from '@/features/models/queries.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { ApiError } from '@/lib/api.ts';
import type { LevelView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { levelsQuery, useLevelChange, type LevelValuesBody } from './queries.ts';
import { Section } from './ReviewLevelsPage.tsx';

const t = copy.levels;

/** The settings every level shows with Inherited / Own value; N sits in the autofix rules. */
const FIELD_KEYS = ['brief', 'maxFindings', 'maxQuestions', 'stageTimeoutMinutes'] as const;
const AUTOFIX = 'autofixMaxPatches';
const AUTOFIX_FROM = 5;
type FieldKey = (typeof FIELD_KEYS)[number] | typeof AUTOFIX;
const modelKey = (role: string) => `model.${role}`;

/** A level's own values as typed: `null` is inherited, a string is the level's own value. */
type Draft = Record<string, string | null>;

function toDraft(own: LevelView['own']): Draft {
  const draft: Draft = {};
  for (const key of [...FIELD_KEYS, AUTOFIX] as const) {
    const value = own[key];
    if (key === 'brief') draft[key] = value === undefined ? null : ((value as string | null) ?? '');
    else draft[key] = value === undefined || value === null ? null : String(value);
  }
  for (const role of AGENT_ROLES) draft[modelKey(role)] = own.models?.[role] ?? null;
  return draft;
}

function invalidValue(key: string, value: string | null): boolean {
  if (value === null || key === 'brief') return false;
  if (key.startsWith('model.')) return !validModelName(value.trim());
  if (!/^\d+$/.test(value.trim())) return true;
  return !LevelSettingsPatchSchema.shape[key as FieldKey].safeParse(Number(value)).success;
}

function toValues(n: LevelNumber, draft: Draft): LevelValuesBody {
  const values: LevelValuesBody = { models: {} };
  for (const key of FIELD_KEYS) {
    const value = draft[key] ?? null;
    if (value === null) values[key] = 'inherit';
    else values[key] = key === 'brief' ? value.trim() || null : Number(value);
  }
  // Levels below 5 have no autofix: leaving N out keeps it inherited.
  if (n >= AUTOFIX_FROM) {
    const value = draft[AUTOFIX] ?? null;
    values[AUTOFIX] = value === null ? 'inherit' : Number(value);
  }
  for (const role of AGENT_ROLES) {
    const value = draft[modelKey(role)] ?? null;
    values.models[role] = value === null ? 'inherit' : value.trim();
  }
  return values;
}

/** Settings → Review levels → one level (S-21-T5, FR-078). */
export function LevelPage({ level }: { level: number }) {
  const levels = useQuery(levelsQuery());
  const models = useQuery(modelsQuery());
  const n = (LEVEL_NUMBERS as readonly number[]).includes(level) ? (level as LevelNumber) : null;
  const view = levels.data?.levels.find((l) => l.number === n);
  const error = levels.error ?? models.error;

  if (!n) {
    return (
      <SettingsPage title={t.title} affects={t.affects}>
        <Breadcrumb />
        <p role="alert" className="text-bad">
          {t.page.unknown}
        </p>
      </SettingsPage>
    );
  }
  return (
    <SettingsPage
      title={t.page.title(n)}
      affects={t.page.affects(n)}
      actions={<Neighbours n={n} />}
    >
      <Breadcrumb n={n} />
      {view && levels.data && models.data ? (
        <LevelForm
          key={n}
          view={view}
          levels={levels.data.levels}
          roleModels={models.data.models}
        />
      ) : error ? (
        <p role="alert" className="text-bad">
          {errorText(error instanceof ApiError ? error.code : 'http_error')}
        </p>
      ) : (
        <p className="text-text-3">{t.loading}</p>
      )}
    </SettingsPage>
  );
}

function LevelForm({
  view,
  levels,
  roleModels,
}: {
  view: LevelView;
  levels: LevelView[];
  roleModels: Record<string, string>;
}) {
  const n = view.number;
  const saved = useMemo(() => toDraft(view.own), [view.own]);
  const fields = useMemo(() => draftFields(), []);
  const form = useSettingsForm<Draft>(saved, fields);
  const change = useLevelChange();
  const [open, setOpen] = useState(false);
  const [tried, setTried] = useState(false);

  // What the level shows without its own values: the levels below it (and the built-in values).
  const inherited = useMemo(() => {
    const overrides = Object.fromEntries(
      levels.map((l) => [l.number, l.number === n ? {} : l.own]),
    ) as LevelOverrides;
    return resolveLevelSettings(n, overrides, roleModels);
  }, [levels, n, roleModels]);

  const invalid = Object.keys(form.draft).filter((key) => invalidValue(key, form.draft[key]!));
  const errorFor = (key: string) =>
    (tried || form.draft[key] !== saved[key]) && invalid.includes(key);

  const settingRow = (key: (typeof FIELD_KEYS)[number]) => {
    const value = inherited.settings[key];
    const origin = inherited.origins[key];
    const label = t.fields[key]!.label;
    const shown =
      key === 'brief'
        ? ((value as string | null) ?? t.noBrief)
        : key === 'stageTimeoutMinutes'
          ? t.minutes(value as number)
          : String(value);
    return (
      <InheritRow
        key={key}
        id={`level-${key}`}
        label={label}
        hint={t.fields[key]!.hint}
        own={form.draft[key] ?? null}
        inheritedText={shown}
        source={t.from(origin.level, origin.source === 'built_in')}
        error={errorFor(key) ? t.invalid[key] : undefined}
        onOwn={(own) =>
          form.set(
            key,
            own ? (key === 'brief' ? ((value as string | null) ?? '') : String(value)) : null,
          )
        }
        input={(props) =>
          key === 'brief' ? (
            <Textarea
              {...props}
              rows={3}
              className="w-full"
              value={form.draft[key] ?? ''}
              onChange={(event) => form.set(key, event.target.value)}
            />
          ) : (
            <span className="flex items-center gap-2">
              <Input
                {...props}
                inputMode="numeric"
                className="w-24"
                value={form.draft[key] ?? ''}
                onChange={(event) => form.set(key, event.target.value)}
              />
              {key === 'stageTimeoutMinutes' && <span className="text-text-3">{t.minUnit}</span>}
            </span>
          )
        }
      />
    );
  };

  return (
    <>
      {tried && invalid.length > 0 && (
        <p role="alert" className="rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
          {t.page.invalidSummary}
        </p>
      )}
      <Section title={t.page.adds} workStart>
        <p className="px-4 py-3 text-sm">
          {view.adds.length === 0 ? (
            <span className="text-text-3">{t.page.addsNothing}</span>
          ) : (
            view.adds.map((key) => t.adds[key] ?? key).join(' · ')
          )}
        </p>
      </Section>
      <Section title={t.settings.title} sub={t.settings.sub}>
        <div className="flex flex-col gap-4 px-4 py-4 text-sm">{FIELD_KEYS.map(settingRow)}</div>
      </Section>
      <Section
        title={t.models.title}
        actions={
          <Link to="/settings/models" className="text-xs text-brand-text underline">
            {t.models.open}
          </Link>
        }
      >
        <div className="flex flex-col gap-4 px-4 py-4 text-sm">
          {AGENT_ROLES.map((role) => {
            const key = modelKey(role);
            const choice = inherited.models[role];
            return (
              <InheritRow
                key={role}
                id={`level-model-${role}`}
                label={copy.models.roles[role] ?? role}
                hint={copy.models.does[role]}
                own={form.draft[key] ?? null}
                inheritedText={choice.model}
                mono
                source={choice.source === 'level' ? t.from(choice.level!, false) : t.fromModels}
                error={errorFor(key) ? t.invalid.model : undefined}
                onOwn={(own) => form.set(key, own ? choice.model : null)}
                input={(props) => (
                  <Input
                    {...props}
                    className="w-full font-mono text-[13px] sm:w-64"
                    value={form.draft[key] ?? ''}
                    onChange={(event) => form.set(key, event.target.value)}
                  />
                )}
              />
            );
          })}
        </div>
      </Section>
      {n >= AUTOFIX_FROM && (
        <AutofixRules
          editable={n === AUTOFIX_FROM}
          value={form.draft[AUTOFIX] ?? String(inherited.settings.autofixMaxPatches ?? '')}
          resolved={view.settings.autofixMaxPatches}
          error={errorFor(AUTOFIX) ? t.invalid[AUTOFIX] : undefined}
          onChange={(value) => form.set(AUTOFIX, value)}
        />
      )}
      <SaveBar
        count={form.changes.length}
        onDiscard={() => {
          form.discard();
          setTried(false);
        }}
        onSave={() => {
          setTried(true);
          if (invalid.length === 0) setOpen(true);
        }}
      />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={t.page.saveTitle(n)}
        description={t.page.saveDescription(n)}
        changes={form.changes}
        onConfirm={(signedBy) =>
          change.mutateAsync({
            level: n,
            before: view.own,
            values: toValues(n, form.draft),
            signedBy,
          })
        }
      />
    </>
  );
}

/** The save dialog's rows: every setting and role model, "Inherited" or the own value. */
function draftFields(): SettingsField<Draft>[] {
  const format = (key: string) => (value: unknown) =>
    value === null ? t.inherited : key === 'brief' && value === '' ? t.noBrief : String(value);
  return [
    ...[...FIELD_KEYS, AUTOFIX].map((key) => ({
      key,
      label: t.fields[key]!.label,
      format: format(key),
    })),
    ...AGENT_ROLES.map((role) => ({
      key: modelKey(role),
      label: t.models.field(copy.models.roles[role] ?? role),
      format: format(role),
    })),
  ];
}

type InputProps = {
  id: string;
  'aria-label': string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/**
 * One setting: the inherited value as plain text with where it comes from, or the level's own
 * value in an input. The ToggleGroup Inherited / Own value switches between them.
 */
function InheritRow(props: {
  id: string;
  label: string;
  hint?: string;
  own: string | null;
  inheritedText: string;
  source: string;
  mono?: boolean;
  error?: string;
  onOwn: (own: boolean) => void;
  input: (props: InputProps) => ReactNode;
}) {
  const isOwn = props.own !== null;
  const errorId = `${props.id}-error`;
  return (
    <div
      data-setting={props.id}
      className="grid gap-1.5 md:grid-cols-[minmax(180px,260px)_1fr] md:gap-4"
    >
      <span className="flex items-start gap-1.5 font-medium">
        <span>{props.label}</span>
        {props.hint && (
          <span title={props.hint} className="mt-0.5 text-text-3">
            <Info aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{props.hint}</span>
          </span>
        )}
      </span>
      <div className="flex min-w-0 flex-col items-start gap-2">
        <ToggleGroup
          type="single"
          aria-label={t.sourceLabel(props.label)}
          value={isOwn ? 'own' : 'inherited'}
          onValueChange={(value) => {
            if (value) props.onOwn(value === 'own');
          }}
        >
          <ToggleGroupItem value="inherited">{t.inherited}</ToggleGroupItem>
          <ToggleGroupItem value="own">{t.own}</ToggleGroupItem>
        </ToggleGroup>
        {isOwn ? (
          <>
            {props.input({
              id: props.id,
              'aria-label': props.label,
              'aria-invalid': props.error ? true : undefined,
              'aria-describedby': props.error ? errorId : undefined,
            })}
            {props.error && (
              <p id={errorId} className="text-xs text-bad">
                {props.error}
              </p>
            )}
          </>
        ) : (
          <p data-inherited className="text-sm">
            <span className={props.mono ? 'font-mono text-[13px]' : undefined}>
              {props.inheritedText}
            </span>{' '}
            <span className="text-text-3">· {props.source}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function AutofixRules(props: {
  editable: boolean;
  value: string;
  resolved: number | null;
  error?: string;
  onChange: (value: string) => void;
}) {
  const a = t.autofix;
  const label = t.fields[AUTOFIX]!.label;
  const rule = (i: number, body: ReactNode) => (
    <li key={i} className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full border border-border text-xs font-semibold"
      >
        {i}
      </span>
      <span className="pt-0.5">{body}</span>
    </li>
  );
  return (
    <Section title={a.title} sub={a.sub}>
      <div className="px-4 py-3 text-sm">
        <ol aria-label={a.title} className="grid gap-2">
          {a.rules.map((text, i) => rule(i + 1, text))}
          {rule(
            4,
            <span className="flex flex-wrap items-center gap-2">
              {a.atMostBefore}
              {props.editable ? (
                <Input
                  aria-label={label}
                  aria-invalid={props.error ? true : undefined}
                  inputMode="numeric"
                  className="h-7 w-16"
                  value={props.value}
                  onChange={(event) => props.onChange(event.target.value)}
                />
              ) : (
                <span className="font-semibold">{props.resolved}</span>
              )}
              {a.atMostAfter}
            </span>,
          )}
        </ol>
        {props.error && <p className="mt-2 text-xs text-bad">{props.error}</p>}
        {props.editable && <p className="mt-2 text-xs text-text-3">{a.only}</p>}
      </div>
    </Section>
  );
}

function Breadcrumb({ n }: { n?: LevelNumber }) {
  return (
    <nav aria-label={t.page.breadcrumb} className="text-sm text-text-3">
      <Link to="/settings/review-levels" className="hover:underline">
        {t.page.back}
      </Link>
      {n && <span> / {t.page.level(n)}</span>}
    </nav>
  );
}

function Neighbours({ n }: { n: LevelNumber }) {
  return (
    <>
      {n > 1 && (
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/review-levels/$level" params={{ level: String(n - 1) }}>
            <ChevronLeft aria-hidden="true" />
            {t.page.level(n - 1)}
          </Link>
        </Button>
      )}
      {n < 6 && (
        <Button asChild variant="outline" size="sm">
          <Link to="/settings/review-levels/$level" params={{ level: String(n + 1) }}>
            {t.page.level(n + 1)}
            <ChevronRight aria-hidden="true" />
          </Link>
        </Button>
      )}
    </>
  );
}
