import { diffSummary, lineDiff } from '@pra/core';
import { useMemo } from 'react';
import { copy } from '@/copy/index.ts';
import { cn } from '@/lib/utils.ts';

const t = copy.instructions.editor;

/**
 * A line diff of two texts: added lines in an `ins`, removed ones in a `del`, unchanged ones
 * plain. Used live in the editor and on the trial's Compare page.
 */
export function DiffView({
  before,
  after,
  label,
}: {
  before: string;
  after: string;
  /** The region's name, for example "Changes against the active version 1". */
  label: string;
}) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const summary = diffSummary(lines);
  const changed = summary.added + summary.removed > 0;

  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold">
        {label}
        {changed && (
          <span className="font-mono text-xs font-normal text-text-3">
            {t.diffSummary(summary.added, summary.removed)}
          </span>
        )}
      </h3>
      {!changed ? (
        <p className="text-sm text-text-3">{t.noChanges}</p>
      ) : (
        <pre className="max-h-[480px] overflow-auto rounded-lg border border-border bg-surface p-2 font-mono text-[12px] leading-5">
          {lines.map((line, i) =>
            line.kind === 'same' ? (
              <div key={i} className="px-2 text-text-3">
                {'  '}
                {line.text}
              </div>
            ) : (
              <DiffLine key={i} kind={line.kind} text={line.text} />
            ),
          )}
        </pre>
      )}
    </section>
  );
}

function DiffLine({ kind, text }: { kind: 'added' | 'removed'; text: string }) {
  const Tag = kind === 'added' ? 'ins' : 'del';
  return (
    <Tag
      className={cn(
        'block px-2 no-underline',
        kind === 'added' ? 'bg-ok-bg text-ok' : 'bg-bad-bg text-bad',
      )}
    >
      <span className="sr-only">{kind === 'added' ? t.added : t.removed}: </span>
      <span aria-hidden="true">{kind === 'added' ? '+ ' : '- '}</span>
      {text}
    </Tag>
  );
}
