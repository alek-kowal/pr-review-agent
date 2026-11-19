import { useState } from 'react';
import { DECISIONS, type Decision } from '@pra/core';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import type { DecisionView, PrView } from '@/lib/api-types.ts';
import { authorName } from '@/lib/next-step.ts';
import { canDecide, DECISION_ICONS } from './decision-ui.ts';
import { DecisionForm } from './DecisionForm.tsx';
import type { FindingSlotProps } from './slots.ts';

/** "Rejected by Tomek (author: Kasia)", or "Rejected by Kasia (author)" when the author signed. */
const decidedByText = (decision: DecisionView, view: PrView): string =>
  copy.decisions.decidedBy(
    decision.decision,
    decision.signedBy.name,
    decision.signedBy.id === view.author.memberId ? null : authorName(view.author),
  );

/** Line slot: a decided finding carries its decision as a badge (FR-036). */
export function DecisionBadge({ finding, view }: FindingSlotProps) {
  const decision = finding.decision;
  if (!decision) return null;
  const Icon = DECISION_ICONS[decision.decision];
  return (
    <Badge
      variant="outline"
      data-testid="decision-badge"
      title={decidedByText(decision, view)}
      className="border-border text-text-2"
    >
      <Icon aria-hidden="true" />
      {copy.decisions.badges[decision.decision]}
    </Badge>
  );
}

/**
 * Action slot: who decided and why, then Implement…, Reject… and Defer to ClickUp…, each opening
 * the small signed form under them.
 */
export function DecideRow({ finding, view, repo, number }: FindingSlotProps) {
  const [form, setForm] = useState<Decision | null>(null);
  const decision = finding.decision;
  const open = canDecide(view);
  if (!decision && !open) return null;
  const Icon = decision ? DECISION_ICONS[decision.decision] : null;

  return (
    <div className="grid gap-3 border-t border-divider pt-3">
      {decision && Icon && !form && (
        <p
          data-testid="decided-by"
          className="flex flex-wrap items-center gap-2 text-sm text-text-2"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          <span className="font-medium text-text">{decidedByText(decision, view)}</span>
          {decision.reason && <span>· {copy.decisions.reasonQuote(decision.reason)}</span>}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-16 text-xs font-medium text-text-3">
            {decision ? copy.decisions.change : copy.decisions.decide}
          </span>
          {DECISIONS.map((d) => {
            const DIcon = DECISION_ICONS[d];
            return (
              <Button
                key={d}
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={form === d}
                onClick={() => setForm(form === d ? null : d)}
              >
                <DIcon aria-hidden="true" />
                {copy.decisions.actions[d]}
              </Button>
            );
          })}
          {!decision && (
            <span className="text-xs text-text-3">
              {finding.needsDecision.needed
                ? copy.decisions.usuallyDecidedBy(authorName(view.author))
                : copy.decisions.optional}
            </span>
          )}
        </div>
      )}
      {form && (
        <DecisionForm
          key={form}
          repo={repo}
          number={number}
          findings={[finding]}
          decision={form}
          onDone={() => setForm(null)}
          onCancel={() => setForm(null)}
        />
      )}
    </div>
  );
}
