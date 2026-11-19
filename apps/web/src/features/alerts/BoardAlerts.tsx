import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BellRing } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import type { CardBadgeSlotProps } from '@/features/board/slots.ts';
import { ALERT_ICON } from './AlertsSection.tsx';
import { alertsQuery, alertTitle } from './queries.ts';

const t = copy.alerts;

/** One red bell on a board card with an active alert; the count shows when there are several. */
export function CardAlertBell({ card }: CardBadgeSlotProps) {
  if (card.alertCount === 0) return null;
  return (
    <span
      data-card-alert={card.alertCount}
      title={t.count(card.alertCount)}
      className="inline-flex items-center gap-0.5 rounded bg-bad-bg px-1 text-[11px] leading-4 font-medium text-bad"
    >
      <BellRing aria-hidden="true" className="size-3" />
      {card.alertCount > 1 && <span className="tabular-nums">{card.alertCount}</span>}
      <span className="sr-only">{t.count(card.alertCount)}</span>
    </span>
  );
}

/**
 * The strip above the board (prototype `AlertStrip`): "N active alerts", one pill per alert (to its
 * PR, or Activity for the daily budget) and "All alerts" to Activity. Nothing when all is calm.
 */
export function AlertStrip() {
  const active = useQuery(alertsQuery('active'));
  const alerts = active.data?.alerts ?? [];
  if (alerts.length === 0) return null;
  return (
    <div
      role="status"
      data-alert-strip={alerts.length}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-bad-line bg-bad-bg px-3 py-2"
    >
      <span className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap text-bad">
        <BellRing aria-hidden="true" className="size-[15px]" />
        {t.count(alerts.length)}
      </span>
      <ul className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
        {alerts.map((alert) => {
          const Icon = ALERT_ICON[alert.kind] ?? BellRing;
          const pr = alert.pullRequest;
          const pill = (
            <>
              <Icon aria-hidden="true" className="size-3" />
              {pr && <span className="font-mono">#{pr.number}</span>}
              {t.short(alert.title)}
            </>
          );
          const className =
            'inline-flex items-center gap-1 rounded-full border border-bad-line bg-surface px-2 text-xs leading-5 text-bad no-underline';
          return (
            <li key={alert.id}>
              {pr ? (
                <Link
                  to="/pr/$repo/$number"
                  params={{ repo: pr.repository.slug, number: String(pr.number) }}
                  title={alertTitle(alert)}
                  className={className}
                >
                  {pill}
                </Link>
              ) : (
                <Link to="/activity" title={alertTitle(alert)} className={className}>
                  {pill}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <Link
        to="/activity"
        className="ml-auto text-sm whitespace-nowrap text-brand-text hover:underline"
      >
        {t.strip.all}
      </Link>
    </div>
  );
}
