import { useState } from 'react';
import { DECISIONS, type Decision } from '@pra/core';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { FindingView } from '@/lib/api-types.ts';
import { DecisionForm } from './DecisionForm.tsx';
import { DECISION_ICONS } from './decision-ui.ts';

/**
 * The sticky bar for selected findings: one signed decision for all of them, in one request.
 * The form opens inside the bar.
 */
export function BulkBar({
  repo,
  number,
  selected,
  onClear,
}: {
  repo: string;
  number: string;
  selected: FindingView[];
  onClear: () => void;
}) {
  const [form, setForm] = useState<Decision | null>(null);

  return (
    <div
      role="region"
      aria-label={copy.decisions.bulk.label}
      data-testid="bulk-bar"
      className="sticky bottom-4 z-30 grid gap-3 rounded-[10px] border border-border-strong bg-surface py-2 pr-2.5 pl-3.5 shadow-md"
    >
      {form && (
        <DecisionForm
          key={form}
          repo={repo}
          number={number}
          findings={selected}
          decision={form}
          onDone={() => {
            setForm(null);
            onClear();
          }}
          onCancel={() => setForm(null)}
          className="mt-0.5"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{copy.decisions.bulk.selected(selected.length)}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          {copy.decisions.bulk.clear}
        </Button>
        <span className="flex-1" />
        <span className="text-xs text-text-3">{copy.decisions.bulk.decide}</span>
        {DECISIONS.map((d) => {
          const Icon = DECISION_ICONS[d];
          return (
            <Button
              key={d}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={form === d}
              onClick={() => setForm(form === d ? null : d)}
            >
              <Icon aria-hidden="true" />
              {copy.decisions.actions[d]}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
