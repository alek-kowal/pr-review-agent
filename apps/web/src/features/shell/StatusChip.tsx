import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { copy } from '@/copy/index.ts';
import { money } from '@/copy/format.ts';
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
  if (!status.data) return null;

  const { state, todaySpendUsd } = status.data;
  const tone = CHIP_TONES[state] ?? 'running';
  const text =
    copy.status.states[state]?.(todaySpendUsd) ?? copy.status.unknownState(state, todaySpendUsd);
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-status-chip={state}
          aria-label={`${copy.status.label}: ${text}`}
          className={`inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium ${TONE_CLASS[tone]}`}
        >
          {tone === 'running' && (
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-ok-solid" />
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
              <span className="font-medium tabular-nums">{money(todaySpendUsd)}</span>
            </div>
            <p className="mt-1 text-xs text-text-3">{copy.status.spentHint}</p>
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
