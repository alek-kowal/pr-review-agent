import { Ban, CheckCheck, ChevronDown, ChevronUp, CircleDashed, CircleHelp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import type { Verdict } from '@pra/core';
import { copy } from '@/copy/index.ts';
import { FINDING_ACTION_SLOTS, FINDING_LINE_SLOTS, type FindingSlotProps } from './slots.ts';
import { SeverityMark } from './SeverityMark.tsx';

const VERDICT_ICONS: Record<Verdict, LucideIcon> = {
  confirmed: CheckCheck,
  refuted: Ban,
  not_proven: CircleHelp,
  unchecked: CircleDashed,
};

const verdictText = (verdict: Verdict, level: number) =>
  verdict === 'unchecked'
    ? copy.findings.verdicts.unchecked(level)
    : copy.findings.verdicts[verdict];

const verdictHint = (verdict: Verdict, level: number) =>
  verdict === 'unchecked'
    ? copy.findings.verdictHints.unchecked(level)
    : copy.findings.verdictHints[verdict];

/** A verdict is evidence, not state: plain grey text with an icon, never a badge. */
function VerdictText({ verdict, level }: { verdict: Verdict; level: number }) {
  const Icon = VERDICT_ICONS[verdict];
  return (
    <span
      data-testid="verdict"
      title={verdictHint(verdict, level)}
      className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${
        verdict === 'confirmed' ? 'font-medium text-text-2' : 'text-text-3'
      }`}
    >
      <Icon aria-hidden="true" className="size-3" />
      {verdictText(verdict, level)}
    </span>
  );
}

/**
 * One finding: a line (severity, title, file and line, slots, verdict) that opens the body
 * (scenario, suggestion, the verifier's evidence, then the action slots).
 */
export function Finding({
  open,
  onToggle,
  ...slotProps
}: FindingSlotProps & { open: boolean; onToggle: () => void }) {
  const { finding: f, round } = slotProps;
  const bodyId = useId();
  const level = round.level.number;
  const dimmed = f.verdict === 'refuted';
  const Chevron = open ? ChevronUp : ChevronDown;

  return (
    <article
      aria-label={`${copy.findings.severities[f.severity].one}: ${f.title}`}
      className="rounded-lg border border-border bg-surface"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="block w-full min-w-0 cursor-pointer rounded-lg px-3 py-2.5 text-left hover:bg-surface-2 aria-expanded:rounded-b-none"
      >
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 lg:flex-nowrap">
          <div className="min-w-[240px] flex-1">
            <div className="flex items-start gap-2">
              <SeverityMark severity={f.severity} className="mt-1.5" />
              <span className={`font-medium ${dimmed ? 'text-text-3' : 'text-text'}`}>
                {f.title}
              </span>
            </div>
            <div className="mt-1 ml-4 font-mono text-[12px] break-all text-text-3">
              {copy.findings.location(f.file, f.line)}
            </div>
          </div>
          <div className="ml-4 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 lg:ml-0 lg:max-w-[46%]">
            {FINDING_LINE_SLOTS.map(({ key, Component }) => (
              <Component key={key} {...slotProps} />
            ))}
            <VerdictText verdict={f.verdict} level={level} />
            <Chevron aria-hidden="true" className="size-4 text-text-3" />
          </div>
        </div>
      </button>
      {open && (
        <div
          id={bodyId}
          className="grid gap-3.5 border-t border-divider px-4 pt-3.5 pb-4 sm:pl-[52px]"
        >
          <div className="grid gap-x-6 gap-y-4 xl:grid-cols-2">
            <div className="grid min-w-0 content-start gap-3.5">
              <Block title={copy.findings.scenario}>
                <p className="text-sm whitespace-pre-wrap">{f.scenario}</p>
              </Block>
              <Block title={copy.findings.suggestion}>
                <p className="text-sm whitespace-pre-wrap">{f.suggestion}</p>
              </Block>
            </div>
            <div className="grid min-w-0 content-start gap-3.5">
              {f.verdict === 'unchecked' && (
                <div className="rounded-lg border border-dashed border-border p-3 text-sm text-text-2">
                  <div className="flex items-center gap-1.5 font-medium text-text">
                    <CircleDashed aria-hidden="true" className="size-3.5" />
                    {copy.findings.verdicts.unchecked(level)}
                  </div>
                  <p className="mt-1">{copy.findings.uncheckedBody}</p>
                </div>
              )}
              {f.evidence.length > 0 && (
                <Block title={copy.findings.evidence}>
                  <ul className="grid gap-2">
                    {f.evidence.map((e, i) => (
                      <li
                        key={i}
                        className="min-w-0 border-l-[3px] border-border-strong py-0.5 pl-2.5"
                      >
                        <div className="font-mono text-[12px] break-all text-text-3">
                          {copy.findings.location(e.file, e.line)}
                        </div>
                        <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[12px] leading-[18px]">
                          {e.quote}
                        </pre>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
            </div>
          </div>
          {FINDING_ACTION_SLOTS.map(({ key, Component }) => (
            <Component key={key} {...slotProps} />
          ))}
        </div>
      )}
    </article>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h4 className="mb-1 text-xs font-semibold text-text-2">{title}</h4>
      {children}
    </section>
  );
}
