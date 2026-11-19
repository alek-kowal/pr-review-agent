import { ExternalLink } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import type { PrView } from '@/lib/api-types.ts';

/** The title plus one grey line (docs/03-design-decisions.md: no state pill, no breadcrumb). */
export function PrHeader({ view }: { view: PrView }) {
  const { pullRequest: pr, latestRound: round } = view;
  const meta = [
    pr.repository.name,
    pr.authorLogin,
    pr.isDraft && copy.pr.draft,
    pr.isFork && copy.pr.fork,
    pr.state === 'closed' && copy.pr.closed,
    pr.state === 'merged' && copy.pr.merged,
    copy.pr.branches(pr.headRef, pr.baseRef),
    copy.pr.commits(pr.commitsCount),
    round && copy.pr.level(round.level.number),
    round
      ? copy.round.status(round.number, copy.round.statusWords[round.status])
      : copy.pr.notReviewed,
  ].filter((part): part is string => typeof part === 'string');

  return (
    <header className="flex flex-col gap-1 pt-1 pb-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <h1 className="min-w-[240px] flex-1 font-heading text-xl font-semibold">
          {pr.title} <span className="font-normal text-text-3">{copy.pr.number(pr.number)}</span>
        </h1>
        <a
          href={pr.githubUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] font-medium text-text-2 no-underline hover:bg-inset hover:text-text"
        >
          <ExternalLink aria-hidden="true" className="size-[13px]" />
          {copy.pr.openOnGitHub}
        </a>
      </div>
      <p data-testid="pr-meta" className="text-[13px] text-text-3">
        {meta.join(' · ')}
      </p>
    </header>
  );
}
