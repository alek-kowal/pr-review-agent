import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, CircleAlert, Pause } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { copy } from '@/copy/index.ts';
import { SpendBar } from '@/features/budget/SpendBar.tsx';
import { useOpenStatusChip } from './open-status-chip.ts';
import { CHIP_SECTIONS, CHIP_SEGMENTS, CHIP_TONES, type ChipTone } from './status-chip-slots.ts';
import { statusQuery } from './status-query.ts';

const TONE_CLASS: Record<ChipTone, string> = {
  running: 'border-border bg-surface text-text-2',
  warn: 'border-warn-line bg-warn-bg text-warn',
  bad: 'border-bad-line bg-bad-bg text-bad',
};

/**
 * The factory's state and today's spend, in the top bar of every page (spec: prototype
 * `shell.js` `StatusChip`). Live updates refresh it when an agent session's cost changes.
 */
export function StatusChip() {
  const status = useQuery(statusQuery());
  const [open, setOpen] = useState(false);
  useOpenStatusChip(useCallback(() => setOpen(true), []));
  if (!status.data) return null;

  const { state, queuedCount, activeAlertCount } = status.data;
  const tone = CHIP_TONES[state] ?? 'running';
  const text = copy.status.states[state](status.data);
  // The segments are marks only; the button's label names the alert count for screen readers.
  const label = `${copy.status.label}: ${text}${activeAlertCount > 0 ? `, ${copy.alerts.count(activeAlertCount)}` : ''}`;
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-status-chip={state}
          aria-label={label}
          className={`inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${TONE_CLASS[tone]}`}
        >
          {tone === 'running' && (
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ok-solid" />
          )}
          {state === 'paused' && <Pause aria-hidden="true" className="size-[13px] shrink-0" />}
          {state === 'budget_reached' && (
            <CircleAlert aria-hidden="true" className="size-[13px] shrink-0" />
          )}
          <span className="truncate tabular-nums">{text}</span>
          {CHIP_SEGMENTS.map(({ key, Component }) => (
            <Component key={key} status={status.data} />
          ))}
          <ChevronDown aria-hidden="true" className="size-[13px] shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,calc(100vw-32px))]">
        <div role="group" aria-label={copy.status.label} className="flex flex-col gap-3 text-sm">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-text-2">{copy.status.spentToday}</span>
              <span className="font-medium tabular-nums">{copy.status.spentOf(status.data)}</span>
            </div>
            <SpendBar status={status.data} className="mt-1.5" />
            <p className="mt-1 text-xs text-text-3">{copy.status.spentHint}</p>
            {queuedCount > 0 && (
              <Link to="/activity" onClick={close} className="mt-1 block text-xs text-brand-text">
                {copy.status.queued(queuedCount)}
              </Link>
            )}
          </div>
          {CHIP_SECTIONS.map(({ key, Component }) => (
            <Component key={key} status={status.data} close={close} />
          ))}
          <Link to="/activity" onClick={close} className="text-xs text-brand-text">
            {copy.status.openActivity}
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
