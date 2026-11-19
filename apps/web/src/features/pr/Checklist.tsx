import { ChevronDown, ChevronUp, CircleCheck, CircleX } from 'lucide-react';
import { useId, useState } from 'react';
import { copy } from '@/copy/index.ts';
import type { ChecklistView } from '@/lib/api-types.ts';
import type { PrSlotProps } from './slots.ts';

type Item = ChecklistView['items'][number];

const reasonLine = ({ reason }: Item): string =>
  copy.checklist.reasons[reason.code]?.(reason.params) ?? copy.unknownReason(reason.code);

function Row({ item }: { item: Item }) {
  const Icon = item.ok ? CircleCheck : CircleX;
  return (
    <li className="flex items-start gap-2 px-3.5 py-[7px] text-[13px]" data-ok={item.ok}>
      <Icon
        aria-hidden="true"
        className={`mt-0.5 size-[15px] shrink-0 ${item.ok ? 'text-ok' : 'text-warn'}`}
      />
      <div className="min-w-0">
        <div className="font-medium">
          <span className="sr-only">
            {item.ok ? copy.checklist.passes : copy.checklist.fails}:{' '}
          </span>
          {copy.checklist.items[item.item]}
        </div>
        <div className="text-xs text-text-3">{reasonLine(item)}</div>
      </div>
    </li>
  );
}

/**
 * The merge checklist: failing rows only, the rest behind "Show all N"; all green is one line
 * that opens the list (docs/03-design-decisions.md).
 */
export function Checklist({ view }: PrSlotProps) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const titleId = useId();
  const { items } = view.checklist;
  const total = items.length;
  const okCount = items.filter((i) => i.ok).length;
  const Chevron = all ? ChevronUp : ChevronDown;

  if (view.checklist.ok) {
    return (
      <section
        aria-label={copy.checklist.title}
        data-testid="checklist"
        data-checklist="ok"
        className="rounded-lg border border-border bg-surface"
      >
        <button
          type="button"
          aria-expanded={all}
          aria-controls={all ? listId : undefined}
          onClick={() => setAll(!all)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] hover:bg-surface-2"
        >
          <CircleCheck aria-hidden="true" className="size-[15px] text-ok" />
          <span className="flex-1 text-left font-medium">{copy.checklist.title}</span>
          <span className="text-text-3 tabular-nums">{copy.checklist.progress(total, total)}</span>
          <Chevron aria-hidden="true" className="size-3.5 text-text-3" />
        </button>
        {all && (
          <ul id={listId} className="border-t border-divider py-1">
            {items.map((item) => (
              <Row key={item.item} item={item} />
            ))}
          </ul>
        )}
      </section>
    );
  }

  const shown = all ? items : items.filter((i) => !i.ok);
  return (
    <section
      aria-labelledby={titleId}
      data-testid="checklist"
      data-checklist="open"
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-divider px-3.5 py-2.5">
        <h2 id={titleId} className="font-heading text-[13px] font-semibold">
          {copy.checklist.title}
        </h2>
        <span className="text-xs text-text-3 tabular-nums">
          {copy.checklist.progress(okCount, total)}
        </span>
      </div>
      <ul id={listId} className="py-1">
        {shown.map((item) => (
          <Row key={item.item} item={item} />
        ))}
      </ul>
      {okCount > 0 && (
        <button
          type="button"
          aria-expanded={all}
          aria-controls={listId}
          onClick={() => setAll(!all)}
          className="cursor-pointer px-3.5 pb-2.5 text-xs text-brand-text hover:underline"
        >
          {all ? copy.checklist.showFailing : copy.checklist.showAll(total)}
        </button>
      )}
    </section>
  );
}
