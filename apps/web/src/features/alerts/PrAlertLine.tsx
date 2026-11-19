import { useQuery } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import { prViewQuery } from '@/features/pr/queries.ts';
import type { PrSlotProps } from '@/features/pr/slots.ts';
import { DismissAlertAction } from './AlertsSection.tsx';

const t = copy.alerts;

/**
 * The PR's active alerts as secondary lines in the Next step banner (prototype `PrAlerts`):
 * "Alert · Posted to ClickUp WB-123 · 5 min ago", with Dismiss for the cost alert.
 */
export function PrAlertLine({ repo, number, view }: PrSlotProps) {
  // "5 min ago" counts from when the view was loaded (renders stay pure), as the board's ages do.
  const now = useQuery(prViewQuery(repo, number)).dataUpdatedAt;
  if (view.alerts.length === 0) return null;
  return (
    <>
      {view.alerts.map((alert) => (
        <p
          key={alert.id}
          data-alert-line={alert.kind}
          className="m-0 flex flex-wrap items-center gap-x-1.5 text-[13px] text-bad"
        >
          <BellRing aria-hidden="true" className="size-[13px] shrink-0" />
          <span>
            {alert.kind === 'cost' ? t.banner.cost(alert.title.params) : t.banner.alert}
            {' · '}
            {t.delivery(alert.delivery)}
            {' · '}
            <time dateTime={alert.delivery.postedAt ?? alert.createdAt}>
              {t.ago(now - Date.parse(alert.delivery.postedAt ?? alert.createdAt))}
            </time>
          </span>
          {alert.kind === 'cost' && <DismissAlertAction alert={alert} variant="link" />}
        </p>
      ))}
    </>
  );
}
