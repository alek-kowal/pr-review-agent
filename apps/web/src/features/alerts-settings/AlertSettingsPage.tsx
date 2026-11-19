import {
  alertCommentText,
  BUDGET_ALERT_PERCENTS,
  reason,
  type AlertConfig,
  type BudgetAlertPercent,
} from '@pra/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { copy } from '@/copy/index.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { alertSettingsQuery, useAlertSettingsChange } from './queries.ts';

const t = copy.alerts.settings;

/** The form's draft: the cost stays the typed text until it is saved. */
type Draft = {
  failedOn: boolean;
  roundsOn: boolean;
  cost: { on: boolean; maxUsd: string };
  budget: { on: boolean; percent: BudgetAlertPercent };
  generalTaskId: string;
};

const toDraft = (config: AlertConfig): Draft => ({
  failedOn: config.failedOn,
  roundsOn: config.roundsOn,
  cost: { on: config.costOn, maxUsd: String(config.costMaxUsd) },
  budget: { on: config.budgetOn, percent: config.budgetPercent },
  generalTaskId: config.generalTaskId ?? '',
});

/** The typed cost in USD, or null when it is not a number above 0. */
const costUsd = (text: string): number | null => {
  const value = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? value : null;
};

const onOff = (on: unknown) => (on ? t.on : t.off);
const FIELDS: readonly SettingsField<Draft>[] = [
  { key: 'failedOn', label: t.failed.label, format: onOff },
  { key: 'roundsOn', label: t.rounds.label, format: onOff },
  {
    key: 'cost',
    label: t.cost.label,
    format: (value) => {
      const cost = value as Draft['cost'];
      return cost.on ? t.values.cost(costUsd(cost.maxUsd) ?? 0) : t.off;
    },
  },
  {
    key: 'budget',
    label: t.budget.label,
    format: (value) => {
      const budget = value as Draft['budget'];
      return budget.on ? t.values.budget(budget.percent) : t.off;
    },
  },
  {
    key: 'generalTaskId',
    label: t.task.label,
    format: (value) => String(value).trim() || t.values.noTask,
  },
];

/**
 * Settings → Alerts (S-21-T9, FR-067): which alerts are on, their thresholds and the general
 * alerts task. Alerts only report; nothing here stops a round. Saving is signed.
 */
export function AlertSettingsPage() {
  const query = useQuery(alertSettingsQuery());
  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {query.data ? (
        <AlertSettingsForm config={query.data.config} />
      ) : query.isError ? (
        <p role="alert" className="text-bad">
          {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
        </p>
      ) : (
        <p className="text-text-3">{t.loading}</p>
      )}
    </SettingsPage>
  );
}

function AlertSettingsForm({ config }: { config: AlertConfig }) {
  const saved = useMemo(() => toDraft(config), [config]);
  const form = useSettingsForm<Draft>(saved, FIELDS);
  const change = useAlertSettingsChange();
  const [open, setOpen] = useState(false);
  const [tried, setTried] = useState(false);
  const [preview, setPreview] = useState(false);
  const { draft } = form;

  const costInvalid = draft.cost.on && costUsd(draft.cost.maxUsd) === null;
  const taskInvalid = draft.generalTaskId.trim() === '';
  const invalid = costInvalid || taskInvalid;

  const after: AlertConfig = {
    failedOn: draft.failedOn,
    roundsOn: draft.roundsOn,
    costOn: draft.cost.on,
    // An off cost alert keeps its saved threshold when the typed one is not valid.
    costMaxUsd: costUsd(draft.cost.maxUsd) ?? config.costMaxUsd,
    budgetOn: draft.budget.on,
    budgetPercent: draft.budget.percent,
    generalTaskId: draft.generalTaskId.trim(),
  };

  return (
    <>
      {tried && invalid && (
        <p role="alert" className="rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
          {t.invalidSummary}
        </p>
      )}
      <Section title={t.when} workStart>
        <Row label={t.failed.label} hint={t.failed.hint} htmlFor="alert-failed">
          <Toggle
            id="alert-failed"
            label={t.failed.toggle}
            checked={draft.failedOn}
            onChange={(on) => form.set('failedOn', on)}
          />
        </Row>
        <Row label={t.rounds.label} hint={t.rounds.hint} htmlFor="alert-rounds">
          <Toggle
            id="alert-rounds"
            label={t.rounds.toggle}
            checked={draft.roundsOn}
            onChange={(on) => form.set('roundsOn', on)}
          />
        </Row>
        <Row label={t.cost.label} hint={t.cost.hint} htmlFor="alert-cost">
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              id="alert-cost"
              label={t.cost.toggle}
              checked={draft.cost.on}
              onChange={(on) => form.set('cost', { ...draft.cost, on })}
            />
            <span
              className={cn('flex items-center gap-2', !draft.cost.on && 'opacity-50')}
              data-cost-threshold
            >
              {t.cost.above} <span className="text-text-3">{t.cost.currency}</span>
              <Input
                aria-label={t.cost.input}
                aria-invalid={(tried && costInvalid) || undefined}
                aria-describedby={tried && costInvalid ? 'alert-cost-error' : undefined}
                inputMode="decimal"
                className="w-24 tabular-nums"
                disabled={!draft.cost.on}
                value={draft.cost.maxUsd}
                onChange={(event) =>
                  form.set('cost', { ...draft.cost, maxUsd: event.target.value })
                }
              />
              <span className="text-text-3">{t.cost.perPr}</span>
            </span>
          </div>
          {tried && costInvalid && (
            <p id="alert-cost-error" className="mt-1 text-xs text-bad">
              {t.cost.invalid}
            </p>
          )}
        </Row>
        <Row label={t.budget.label} hint={t.budget.hint} htmlFor="alert-budget">
          <div className="flex flex-wrap items-center gap-3">
            <Toggle
              id="alert-budget"
              label={t.budget.toggle}
              checked={draft.budget.on}
              onChange={(on) => form.set('budget', { ...draft.budget, on })}
            />
            <span className={cn('flex items-center gap-2', !draft.budget.on && 'opacity-50')}>
              {t.budget.at}
              <Select
                value={String(draft.budget.percent)}
                disabled={!draft.budget.on}
                onValueChange={(value) =>
                  form.set('budget', {
                    ...draft.budget,
                    percent: Number(value) as BudgetAlertPercent,
                  })
                }
              >
                <SelectTrigger aria-label={t.budget.select} className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_ALERT_PERCENTS.map((percent) => (
                    <SelectItem key={percent} value={String(percent)}>
                      {t.budget.percent(percent)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-text-3">{t.budget.andFull}</span>
            </span>
          </div>
        </Row>
      </Section>
      <Section title={t.where}>
        <Row label={t.comment.label} hint={t.comment.hint}>
          <div className="flex flex-wrap items-center gap-3">
            <span>{t.comment.where}</span>
            <button
              type="button"
              className="text-brand-text hover:underline"
              aria-expanded={preview}
              aria-controls="alert-comment-preview"
              onClick={() => setPreview(!preview)}
            >
              {preview ? t.comment.hide : t.comment.show}
            </button>
          </div>
          {preview && <CommentPreview maxUsd={after.costMaxUsd} />}
        </Row>
        <Row label={t.task.label} hint={t.task.hint} htmlFor="alert-task">
          <Input
            id="alert-task"
            aria-label={t.task.input}
            aria-invalid={(tried && taskInvalid) || undefined}
            aria-describedby={tried && taskInvalid ? 'alert-task-error' : undefined}
            className="w-44 font-mono text-[13px]"
            placeholder={t.task.placeholder}
            value={draft.generalTaskId}
            onChange={(event) => form.set('generalTaskId', event.target.value)}
          />
          {tried && taskInvalid && (
            <p id="alert-task-error" className="mt-1 text-xs text-bad">
              {t.task.invalid}
            </p>
          )}
        </Row>
        <Row label={t.dashboard.label} hint={t.dashboard.hint}>
          <span>
            {t.dashboard.value} ·{' '}
            <Link to="/activity" className="text-brand-text hover:underline">
              {t.dashboard.activity}
            </Link>
          </span>
        </Row>
      </Section>
      <SaveBar
        count={form.changes.length}
        onDiscard={() => {
          form.discard();
          setTried(false);
        }}
        onSave={() => {
          setTried(true);
          if (!invalid) setOpen(true);
        }}
      />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={t.saveTitle}
        changes={form.changes}
        onConfirm={(signedBy) => change.mutateAsync({ before: config, after, signedBy })}
      />
    </>
  );
}

const SAMPLE_PR = 42;

/** The ClickUp comment the worker posts (core `alertCommentText`), for a sample cost alert. */
function CommentPreview({ maxUsd }: { maxUsd: number }) {
  const text = alertCommentText({
    title: reason('alert_cost', {
      prNumber: SAMPLE_PR,
      spentUsd: Math.round(maxUsd * 108) / 100,
      maxUsd,
    }),
    nextStep: reason('alert_next_split'),
    prNumber: SAMPLE_PR,
    link: `${window.location.origin}/pr/${t.comment.sampleRepo}/${SAMPLE_PR}`,
  });
  return (
    <figure
      id="alert-comment-preview"
      className="mt-2 max-w-[70ch] rounded-lg border border-border bg-surface-2 px-3 py-2"
    >
      <figcaption className="mb-1 text-xs text-text-3">{t.comment.example(SAMPLE_PR)}</figcaption>
      <p data-comment-preview className="text-sm whitespace-pre-line">
        {text}
      </p>
    </figure>
  );
}

function Toggle(props: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <span className="flex items-center gap-2">
      <Switch
        id={props.id}
        aria-label={props.label}
        checked={props.checked}
        onCheckedChange={props.onChange}
      />
      <span>{onOff(props.checked)}</span>
    </span>
  );
}

function Section(props: { title: string; workStart?: boolean; children: ReactNode }) {
  return (
    <section
      aria-label={props.title}
      data-work-start={props.workStart ? '' : undefined}
      className="rounded-lg border border-border bg-surface"
    >
      <header className="border-b border-divider px-4 py-2.5">
        <h2 className="text-sm font-semibold">{props.title}</h2>
      </header>
      <div className="flex flex-col gap-4 px-4 py-4 text-sm">{props.children}</div>
    </section>
  );
}

function Row(props: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  const Label = props.htmlFor ? 'label' : 'span';
  return (
    <div className="grid gap-1.5 md:grid-cols-[minmax(180px,260px)_1fr] md:gap-4">
      <span className="flex items-start gap-1.5 font-medium">
        <Label htmlFor={props.htmlFor}>{props.label}</Label>
        {props.hint && (
          <span title={props.hint} className="mt-0.5 text-text-3">
            <Info aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{props.hint}</span>
          </span>
        )}
      </span>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}
