// Small pieces the Insights tabs share.
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';
import type { QualityRates } from './types.ts';

const t = copy.insights;

/** A collapsed section (native `<details>`). */
export function Fold({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-2">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        {title}
      </summary>
      {children}
    </details>
  );
}

/** A card with a heading row. */
export function Card(props: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={props.id} className="rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider px-4 py-2.5">
        <h2 id={props.id} className="m-0 font-heading text-sm font-semibold">
          {props.title}
        </h2>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <li className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-4 py-3">
      <span className="text-xs text-text-3">{label}</span>
      <span className="font-heading text-xl font-semibold tabular-nums">{value}</span>
      {sub && <span className="text-xs text-text-3">{sub}</span>}
    </li>
  );
}

/** Horizontal bars, one per row, scaled to the largest. */
export function Bars({ label, rows }: { label: string; rows: { name: string; usd: number }[] }) {
  const max = Math.max(...rows.map((row) => row.usd), 0);
  if (rows.length === 0) return <p className="m-0 text-sm text-text-3">{t.cost.nothing}</p>;
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row) => (
        <li
          key={row.name}
          className="grid grid-cols-[minmax(0,8rem)_1fr_4.5rem] items-center gap-2 text-sm"
        >
          <span className="truncate text-text-2">{row.name}</span>
          <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-inset">
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${max > 0 ? Math.max(1, (row.usd / max) * 100) : 0}%` }}
            />
          </span>
          <span className="text-right font-medium tabular-nums">{t.money(row.usd)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Rate cells of a quality row: below 5 findings one "too few" cell spans them all; otherwise
 * Confirmed (and Refuted) say "Unchecked" when no round verified.
 */
export function RateCells({ rates, refuted }: { rates: QualityRates; refuted: boolean }) {
  const cell = 'px-3 py-1.5 text-right tabular-nums';
  if (rates.tooFew) {
    return (
      <td colSpan={refuted ? 3 : 2} className={`${cell} text-text-3`} title={t.tooFewHint}>
        {t.tooFewFindings(rates.findings)}
      </td>
    );
  }
  const rate = (value: number | null) => (value === null ? t.none : t.percent(value));
  const verdict = (value: number | null) =>
    rates.unchecked ? (
      <span className="text-text-3" title={t.uncheckedHint}>
        {t.unchecked}
      </span>
    ) : (
      rate(value)
    );
  return (
    <>
      <td className={cell}>{verdict(rates.confirmedRate)}</td>
      {refuted && <td className={cell}>{verdict(rates.refutedRate)}</td>}
      <td className={`${cell} font-medium`}>{rate(rates.implementShare)}</td>
    </>
  );
}
