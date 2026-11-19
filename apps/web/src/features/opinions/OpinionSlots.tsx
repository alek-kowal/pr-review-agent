// S-08-T6: opinions on a finding (spec: `prototype/js/findings.js` `Finding`). The line shows
// counts and "your draft"; the open finding lists the team's opinions and takes a draft one.
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { copy } from '@/copy/index.ts';
import { dateTime } from '@/copy/format.ts';
import type { OpinionValue, OpinionView } from '@/lib/api-types.ts';
import { canDecide } from '@/features/findings/decision-ui.ts';
import type { FindingSlotProps } from '@/features/findings/slots.ts';
import { useReviewDraft } from './draft.ts';
import { OPINION_ICONS, OPINION_VALUES } from './opinion-ui.ts';

const t = copy.opinions;

const namesOf = (opinions: OpinionView[], value: OpinionValue) =>
  opinions.filter((o) => o.value === value).map((o) => o.signedBy.name);

/** Line slot: thumbs up and down counts (grey text, never a badge), then "your draft". */
export function OpinionCounts({ finding, repo, number }: FindingSlotProps) {
  const { draft } = useReviewDraft(repo, number);
  const worth = namesOf(finding.opinions, 'worth');
  const notWorth = namesOf(finding.opinions, 'not_worth');
  const drafted = draft.get(finding.id);
  if (worth.length + notWorth.length === 0 && !drafted) return null;
  const DraftIcon = drafted ? OPINION_ICONS[drafted.value] : null;
  return (
    <>
      {worth.length + notWorth.length > 0 && (
        <span
          data-testid="opinion-counts"
          title={t.counts(worth, notWorth)}
          aria-label={t.counts(worth, notWorth)}
          className="inline-flex items-center gap-2 text-xs text-text-3"
        >
          {worth.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <ThumbsUp aria-hidden="true" className="size-[11px]" />
              {worth.length}
            </span>
          )}
          {notWorth.length > 0 && (
            <span className="inline-flex items-center gap-0.5">
              <ThumbsDown aria-hidden="true" className="size-[11px]" />
              {notWorth.length}
            </span>
          )}
        </span>
      )}
      {DraftIcon && (
        <span className="inline-flex items-center gap-1 text-xs text-brand-text">
          <DraftIcon aria-hidden="true" className="size-[11px]" />
          {t.yourDraft}
        </span>
      )}
    </>
  );
}

/**
 * Action slot: the team's opinions with names, comments and "from round N" for carried ones;
 * while the PR is open, Worth implementing / Not worth it and an optional comment for the draft.
 */
export function OpinionsBlock({ finding, view, repo, number }: FindingSlotProps) {
  const { draft, toggle, setComment } = useReviewDraft(repo, number);
  const drafted = draft.get(finding.id);
  const open = canDecide(view);
  const commentId = useId();
  return (
    <section className="grid gap-3" aria-label={t.heading(finding.opinions.length)}>
      <div>
        <h4 className="mb-1.5 text-xs font-medium tracking-wide text-text-3 uppercase">
          {t.heading(finding.opinions.length)}
        </h4>
        {finding.opinions.length === 0 ? (
          <p className="text-sm text-text-3">{t.none}</p>
        ) : (
          <ul className="grid gap-1.5" data-testid="opinions">
            {finding.opinions.map((o) => (
              <OpinionLine key={o.id} opinion={o} />
            ))}
          </ul>
        )}
      </div>
      {open && (
        <div className="grid gap-2 border-t border-divider pt-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.label}>
            <span className="w-16 text-xs font-medium text-text-3">{t.label}</span>
            {OPINION_VALUES.map((value) => {
              const Icon = OPINION_ICONS[value];
              return (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-pressed={drafted?.value === value}
                  onClick={() => toggle(finding.id, value)}
                >
                  <Icon aria-hidden="true" />
                  {t.values[value]}
                </Button>
              );
            })}
          </div>
          {drafted && (
            <>
              <label htmlFor={commentId} className="sr-only">
                {t.commentLabel}
              </label>
              <Input
                id={commentId}
                value={drafted.comment}
                placeholder={t.commentPlaceholder}
                onChange={(e) => setComment(finding.id, e.target.value)}
              />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function OpinionLine({ opinion: o }: { opinion: OpinionView }) {
  const Icon = OPINION_ICONS[o.value];
  return (
    <li className="text-sm">
      <span className="font-medium">{o.signedBy.name}</span>{' '}
      <span className="inline-flex items-center gap-1 text-text-2">
        <Icon aria-hidden="true" className="size-3" />
        {t.values[o.value]}
      </span>
      {o.comment && <span className="text-text-2"> · {t.comment(o.comment)}</span>}{' '}
      <span className="text-xs text-text-3">
        ·{' '}
        {o.carried && (
          <>
            <span title={t.carriedHint}>{t.fromRound(o.fromRound)}</span> ·{' '}
          </>
        )}
        <time dateTime={o.at}>{dateTime(o.at)}</time>
      </span>
    </li>
  );
}
