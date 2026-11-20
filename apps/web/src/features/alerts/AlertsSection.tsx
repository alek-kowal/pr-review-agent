import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  BellRing,
  ChevronRight,
  CircleCheck,
  CircleX,
  Gauge,
  Repeat,
  RotateCcw,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible.tsx';
import { copy } from '@/copy/index.ts';
import { RunDetailsLink } from '@/features/runs/RunDetailsLink.tsx';
import { useRetryRun } from '@/features/runs/retry.ts';
import { ApiError } from '@/lib/api.ts';
import type { AlertView } from '@/lib/api-types.ts';
import { errorText, stageName } from '@/lib/reasons.ts';
import { alertNextStep, alertsQuery, alertTitle, useDismissAlert } from './queries.ts';

const t = copy.alerts;

export const ALERT_ICON: Record<AlertView['kind'], LucideIcon> = {
  failed: CircleX,
  rounds: Repeat,
  cost: Wallet,
  budget: Gauge,
};

/**
 * Activity → Alerts (S-18-T6, prototype `metrics.js` `AlertsSection`): the active alerts above In
 * progress. A run-failed alert carries "Retry from <stage>", the cost alert carries Dismiss (the
 * others clear by themselves). Past alerts sit behind "Show N past alerts".
 */
export function AlertsSection() {
  const active = useQuery(alertsQuery('active'));
  const [showPast, setShowPast] = useState(false);
  const past = useQuery({ ...alertsQuery('past'), enabled: showPast });
  const alerts = active.data?.alerts ?? [];
  const pastCount = active.data?.pastCount ?? 0;

  return (
    <section aria-labelledby="activity-alerts" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 id="activity-alerts" className="m-0 flex items-center gap-2 text-sm font-semibold">
          {t.section.title}
          {alerts.length > 0 && (
            <span
              data-testid="alerts-count"
              className="rounded-full bg-bad-bg px-1.5 text-xs font-medium text-bad tabular-nums"
            >
              {alerts.length}
            </span>
          )}
        </h2>
        <Link to="/settings/alerts" className="ml-auto text-xs text-brand-text hover:underline">
          {t.section.settings}
        </Link>
      </div>
      {active.isPending ? (
        <p className="text-sm text-text-3">{t.section.loading}</p>
      ) : active.isError ? (
        <p role="alert" className="text-bad">
          {errorText(active.error instanceof ApiError ? active.error.code : 'http_error')}
        </p>
      ) : alerts.length === 0 ? (
        <p
          data-alerts-calm
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-text-2"
        >
          <CircleCheck aria-hidden="true" className="size-4 text-ok" />
          {t.section.calm}
        </p>
      ) : (
        <AlertTable alerts={alerts} label={t.section.title} now={active.dataUpdatedAt} />
      )}
      {pastCount > 0 && (
        <Collapsible open={showPast} onOpenChange={setShowPast}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              data-past-alerts
              className="flex items-center gap-1 self-start bg-transparent p-0 text-xs font-medium text-brand-text hover:underline"
            >
              <ChevronRight
                aria-hidden="true"
                className={cn('size-3.5 transition-transform', showPast && 'rotate-90')}
              />
              {showPast ? t.section.hidePast : t.section.showPast(pastCount)}
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {past.data ? (
              <AlertTable
                alerts={past.data.alerts}
                label={t.section.showPast(pastCount)}
                now={past.dataUpdatedAt}
              />
            ) : (
              <p className="text-sm text-text-3">{t.section.loading}</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  );
}

/** `now`: when the list was loaded; "5 min ago" counts from it, so renders stay pure. */
function AlertTable({ alerts, label, now }: { alerts: AlertView[]; label: string; now: number }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="text-xs text-text-3">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">
              {t.section.columns.alert}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t.section.columns.when}
            </th>
            <th scope="col" className="px-4 py-2">
              <span className="sr-only">{t.section.columns.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider border-t border-divider">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} now={now} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AlertRow({ alert, now }: { alert: AlertView; now: number }) {
  const on = alert.status === 'active';
  const Icon = ALERT_ICON[alert.kind] ?? BellRing;
  const pr = alert.pullRequest;
  const title = alertTitle(alert);
  const retry = on && alert.kind === 'failed' && alert.runId !== null && pr !== null;
  return (
    <tr data-alert={alert.id} data-alert-kind={alert.kind} data-alert-status={alert.status}>
      <td className="px-4 py-2.5">
        <div className="flex items-start gap-2">
          <Icon
            aria-hidden="true"
            className={cn('mt-0.5 size-3.5 shrink-0', on ? 'text-bad' : 'text-text-3')}
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={on ? 'font-medium' : 'text-text-2'} title={t.delivery(alert.delivery)}>
              {pr ? (
                <Link
                  to="/pr/$repo/$number"
                  params={{ repo: pr.repository.slug, number: String(pr.number) }}
                  className="text-inherit"
                >
                  {title}
                </Link>
              ) : (
                title
              )}
            </span>
            {on && !retry && <span className="text-xs text-text-3">{alertNextStep(alert)}</span>}
            <span data-alert-delivery={alert.delivery.status} className="text-xs text-text-3">
              {t.delivery(alert.delivery)}
            </span>
            {!on && alert.endNote && (
              <span className="text-xs text-text-3">{t.endNote(alert.endNote)}</span>
            )}
            {alert.kind === 'failed' && alert.runId !== null && (
              <RunDetailsLink runId={alert.runId} className="text-xs">
                {t.section.runDetails}
              </RunDetailsLink>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-right whitespace-nowrap text-text-3">
        {!on && (
          <span>{alert.status === 'resolved' ? t.section.cleared : t.section.dismissed} · </span>
        )}
        <time dateTime={alert.endedAt ?? alert.createdAt}>
          {t.ago(now - Date.parse(alert.endedAt ?? alert.createdAt))}
        </time>
      </td>
      <td className="px-4 py-2.5 text-right">
        {retry ? (
          <RetryAlertAction alert={alert} />
        ) : on && alert.kind === 'cost' ? (
          <DismissAlertAction alert={alert} />
        ) : null}
      </td>
    </tr>
  );
}

function RetryAlertAction({ alert }: { alert: AlertView }) {
  const pr = alert.pullRequest!;
  const retry = useRetryRun(pr.repository.slug, String(pr.number));
  const stage = stageName(String(alert.nextStep.params.stage ?? ''));
  return (
    <Button
      size="sm"
      variant="secondary"
      title={copy.runs.retry.hint}
      disabled={retry.isPending}
      onClick={() => alert.runId !== null && retry.mutate(alert.runId)}
    >
      <RotateCcw aria-hidden="true" className="size-[13px]" />
      {copy.runs.retry.action(stage)}
    </Button>
  );
}

export function DismissAlertAction({
  alert,
  variant = 'button',
}: {
  alert: AlertView;
  variant?: 'button' | 'link';
}) {
  const dismiss = useDismissAlert();
  if (variant === 'link') {
    return (
      <button
        type="button"
        title={t.dismiss.hint}
        disabled={dismiss.isPending}
        onClick={() => dismiss.mutate(alert.id)}
        className="bg-transparent p-0 text-[13px] font-medium text-brand-text hover:underline"
      >
        {t.dismiss.action}
      </button>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      title={t.dismiss.hint}
      disabled={dismiss.isPending}
      onClick={() => dismiss.mutate(alert.id)}
    >
      <X aria-hidden="true" className="size-[13px]" />
      {t.dismiss.action}
    </Button>
  );
}
