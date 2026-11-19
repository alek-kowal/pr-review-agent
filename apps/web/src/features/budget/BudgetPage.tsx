import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MAX_AGENT_SLOTS } from '@pra/core';
import { CircleAlert, Pause, Play } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { copy } from '@/copy/index.ts';
import { dateTime, money } from '@/copy/format.ts';
import { ModelAuthLine } from '@/features/shell/ModelAuthLine.tsx';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { statusQuery } from '@/features/shell/status-query.ts';
import { ApiError } from '@/lib/api.ts';
import type { StatusResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { parseBudget, parseSlots } from './parse.ts';
import { useStatusChange } from './queries.ts';
import { SpendBar } from './SpendBar.tsx';

const t = copy.budget;

/** The form's draft: the inputs' text. */
type BudgetForm = { dailyBudgetUsd: string; agentSlots: string };

const FIELDS: readonly SettingsField<BudgetForm>[] = [
  {
    key: 'dailyBudgetUsd',
    label: t.spend.dailyBudget,
    format: (text) => {
      const budget = parseBudget(text);
      return budget === null ? t.save.noBudget : money(budget);
    },
  },
  { key: 'agentSlots', label: t.queue.slots },
];

/**
 * Settings → General → Budget & status (S-10-T5, spec: prototype `settings.js` `SetBudget`):
 * pause and resume, today's spend, the daily budget and the agent slots, each change signed.
 */
export function BudgetPage() {
  const query = useQuery(statusQuery());
  const status = query.data;
  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {!status ? (
        query.isError ? (
          <p role="alert" data-work-start className="text-bad">
            {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
          </p>
        ) : (
          <p className="text-text-3">{t.loading}</p>
        )
      ) : (
        <>
          <StatusCard status={status} />
          <LimitsForm status={status} />
        </>
      )}
    </SettingsPage>
  );
}

function StatusCard({ status }: { status: StatusResponse }) {
  const s = t.status;
  const change = useStatusChange();
  const [reason, setReason] = useState('');
  const [dialog, setDialog] = useState<'pause' | 'resume' | null>(null);
  const paused = status.state === 'paused';
  const Icon = paused ? Pause : status.state === 'budget_reached' ? CircleAlert : Play;
  const pill = cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
    status.state === 'running' && 'border-ok-line bg-ok-bg text-ok',
    paused && 'border-warn-line bg-warn-bg text-warn',
    status.state === 'budget_reached' && 'border-bad-line bg-bad-bg text-bad',
  );

  return (
    <Card
      title={s.title}
      workStart
      right={
        <span className={pill} data-status-state={status.state}>
          <Icon aria-hidden="true" className="size-3" />
          {t.states[status.state]}
        </span>
      }
    >
      {paused ? (
        <Row label={s.pausedBy(status.pausedBy?.name ?? null)} hint={s.pausedHint}>
          <p className="mb-2 text-sm">
            <span className="font-medium">{status.pausedReason}</span>
            {status.pausedAt && (
              <time dateTime={status.pausedAt} className="ml-1.5 text-text-3">
                {dateTime(status.pausedAt)}
              </time>
            )}
          </p>
          <Button type="button" onClick={() => setDialog('resume')}>
            <Play aria-hidden="true" />
            {s.resume}
          </Button>
        </Row>
      ) : (
        <Row label={s.pause} hint={s.pauseHint} htmlFor="budget-pause-reason">
          <div className="flex flex-wrap gap-2">
            <Input
              id="budget-pause-reason"
              className="min-w-[220px] flex-1"
              placeholder={s.pausePlaceholder}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!reason.trim()}
              title={reason.trim() ? undefined : s.reasonFirst}
              onClick={() => setDialog('pause')}
            >
              <Pause aria-hidden="true" />
              {s.pauseButton}
            </Button>
          </div>
        </Row>
      )}
      <SignedSaveDialog
        open={dialog === 'pause'}
        onOpenChange={(open) => setDialog(open ? 'pause' : null)}
        title={s.pauseTitle}
        description={s.pauseDescription}
        confirmLabel={s.pauseConfirm}
        changes={[
          { key: 'status', label: s.field, before: s.running, after: s.pausedValue(reason.trim()) },
        ]}
        onConfirm={async (signedBy) => {
          await change.mutateAsync({ kind: 'pause', reason: reason.trim(), signedBy });
          setReason('');
        }}
      />
      <SignedSaveDialog
        open={dialog === 'resume'}
        onOpenChange={(open) => setDialog(open ? 'resume' : null)}
        title={s.resumeTitle}
        description={s.resumeDescription}
        confirmLabel={s.resumeConfirm}
        changes={[
          {
            key: 'status',
            label: s.field,
            before: s.pausedValue(status.pausedReason ?? ''),
            after: s.running,
          },
        ]}
        onConfirm={(signedBy) => change.mutateAsync({ kind: 'resume', signedBy })}
      />
    </Card>
  );
}

function LimitsForm({ status }: { status: StatusResponse }) {
  const saved = useMemo<BudgetForm>(
    () => ({
      dailyBudgetUsd: status.dailyBudgetUsd === null ? '' : String(status.dailyBudgetUsd),
      agentSlots: String(status.agentSlots),
    }),
    [status.dailyBudgetUsd, status.agentSlots],
  );
  const form = useSettingsForm(saved, FIELDS);
  const change = useStatusChange();
  const [open, setOpen] = useState(false);
  const budgetText = form.draft.dailyBudgetUsd;
  const budgetValid = budgetText.trim() === '' || parseBudget(budgetText) !== null;
  const slots = parseSlots(form.draft.agentSlots);

  async function save(signedBy: string) {
    const budget = parseBudget(budgetText);
    if (budget !== status.dailyBudgetUsd) {
      await change.mutateAsync({
        kind: 'budget',
        dailyBudgetUsd: budget,
        before: status.dailyBudgetUsd,
        signedBy,
      });
    }
    if (slots !== null && slots !== status.agentSlots) {
      await change.mutateAsync({
        kind: 'slots',
        agentSlots: slots,
        before: status.agentSlots,
        signedBy,
      });
    }
  }

  return (
    <>
      <Card title={t.spend.title}>
        <Row label={t.spend.spentToday} hint={t.spend.spentHint}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-lg font-semibold tabular-nums">
              {money(status.todaySpendUsd)}
            </span>
            <span className="text-text-3 tabular-nums">
              {status.dailyBudgetUsd === null
                ? t.spend.noBudget
                : t.spend.of(status.dailyBudgetUsd)}
            </span>
          </div>
          <SpendBar status={status} className="mt-1.5" />
          <p className="mt-1 text-xs text-text-3">{t.spend.timeZone(status.timeZone)}</p>
          <Link to="/insights/cost" className="mt-2 inline-block text-xs text-brand-text">
            {t.spend.insightsLink}
          </Link>
          <div className="mt-3">
            <ModelAuthLine mode={status.modelAuth} withHint />
          </div>
        </Row>
        <Row label={t.spend.dailyBudget} hint={t.spend.dailyBudgetHint} htmlFor="budget-daily">
          <div className="flex items-center gap-2">
            <span className="text-text-3">$</span>
            <Input
              id="budget-daily"
              inputMode="decimal"
              className="w-[120px] tabular-nums"
              aria-invalid={!budgetValid}
              value={budgetText}
              onChange={(event) => form.set('dailyBudgetUsd', event.target.value)}
            />
            <span className="text-sm text-text-3">{t.spend.perDay}</span>
          </div>
          {!budgetValid && <p className="mt-1 text-xs text-bad">{t.spend.invalid}</p>}
        </Row>
      </Card>
      <Card
        title={t.queue.title}
        right={
          <Link to="/activity" className="text-xs text-brand-text">
            {t.queue.openActivity}
          </Link>
        }
      >
        <Row label={t.queue.slots} hint={t.queue.slotsHint} htmlFor="budget-slots">
          <Input
            id="budget-slots"
            type="number"
            min={1}
            max={MAX_AGENT_SLOTS}
            className="w-[120px] tabular-nums"
            aria-invalid={slots === null}
            value={form.draft.agentSlots}
            onChange={(event) => form.set('agentSlots', event.target.value)}
          />
          {slots === null && (
            <p className="mt-1 text-xs text-bad">{t.queue.slotsInvalid(MAX_AGENT_SLOTS)}</p>
          )}
        </Row>
        <Row label={t.queue.waiting}>
          <span className="text-sm text-text-3">
            {status.queuedCount > 0 ? t.queue.queued(status.queuedCount) : t.queue.nothing}
          </span>
        </Row>
      </Card>
      <SaveBar
        count={budgetValid && slots !== null ? form.changes.length : 0}
        onDiscard={form.discard}
        onSave={() => setOpen(true)}
      />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={t.save.title}
        changes={form.changes}
        onConfirm={save}
      />
    </>
  );
}

function Card({
  title,
  right,
  workStart,
  children,
}: {
  title: string;
  right?: ReactNode;
  /** The page's first card: where its work starts (`data-work-start`). */
  workStart?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-work-start={workStart ? '' : undefined}
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)] sm:gap-6">
      <div>
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </label>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
        {hint && <p className="mt-0.5 text-xs text-text-3">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
