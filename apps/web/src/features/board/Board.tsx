import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bot, ChevronRight, CircleCheck, CircleDashed, UserRound } from 'lucide-react';
import { byUrgency, LANES, type Lane } from '@pra/core';
import { cn } from 'cn';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import type { BoardCard as Card, BoardResponse } from '@/lib/api-types.ts';
import { authorName, bannerText, stepContext } from '@/lib/next-step.ts';
import { errorText } from '@/lib/reasons.ts';
import { BoardCard, DraftRow } from './BoardCard.tsx';
import { boardQuery } from './queries.ts';

const LANE_ICON = {
  not_reviewed: CircleDashed,
  agents_working: Bot,
  action_needed: UserRound,
  ready_to_merge: CircleCheck,
} satisfies Record<Lane, unknown>;

/** The board (`/prs`): four lanes by whose move it is, from `GET /api/board`. */
export function Board() {
  const board = useQuery(boardQuery());

  return (
    <section className="flex flex-col gap-4">
      <h1 className="font-heading text-xl font-semibold">{copy.board.title}</h1>
      {board.isPending ? (
        <p className="text-text-3">{copy.board.loading}</p>
      ) : board.isError ? (
        <p role="alert" className="text-bad">
          {errorText(board.error instanceof ApiError ? board.error.code : 'http_error')}
        </p>
      ) : (
        <>
          <Lanes board={board.data} now={board.dataUpdatedAt} />
          <MergedOrClosed cards={board.data.mergedOrClosed} />
        </>
      )}
    </section>
  );
}

/** Action needed by urgency (FR-008), then the longest waiting first. */
const sortByUrgency = (cards: Card[]) =>
  [...cards].sort((a, b) =>
    byUrgency(
      { state: a.nextStep.state, openedAt: a.openedAt },
      { state: b.nextStep.state, openedAt: b.openedAt },
    ),
  );

function Lanes({ board, now }: { board: BoardResponse; now: number }) {
  const showRepository = board.repositoryCount > 1;
  return (
    <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_1fr]">
      {LANES.map((lane) => {
        const hot = lane === 'action_needed';
        const cards = hot ? sortByUrgency(board.lanes[lane].cards) : board.lanes[lane].cards;
        const drafts = lane === 'not_reviewed' ? board.lanes.not_reviewed.drafts : [];
        const count = cards.length + drafts.length;
        const Icon = LANE_ICON[lane];
        const id = `lane-${lane}`;
        return (
          <section
            key={lane}
            aria-labelledby={id}
            data-lane={lane}
            className={cn(
              'flex min-w-0 flex-col gap-2 rounded-xl bg-inset p-2',
              hot && 'md:col-span-2 xl:col-span-1',
            )}
          >
            <h2
              id={id}
              className={cn(
                'flex items-center gap-1.5 px-1 pt-1 text-sm font-semibold',
                hot && 'text-warn',
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn('size-4', hot ? 'text-warn' : 'text-text-3')}
              />
              {copy.board.lanes[lane].name}
              <span
                aria-label={copy.board.count(count)}
                className={cn(
                  'ml-auto rounded-full px-1.5 text-xs tabular-nums',
                  hot && count > 0 ? 'bg-warn-solid text-on-warn' : 'bg-surface text-text-3',
                )}
              >
                {count}
              </span>
            </h2>
            {count === 0 && (
              <p className="px-1 pb-1 text-[13px] text-text-3">{copy.board.lanes[lane].empty}</p>
            )}
            {cards.length > 0 && (
              <ul className={cn('grid gap-2', hot && 'xl:grid-cols-2')}>
                {cards.map((card) => (
                  <li key={`${card.repository.slug}#${card.number}`}>
                    <BoardCard card={card} showRepository={showRepository} now={now} />
                  </li>
                ))}
              </ul>
            )}
            {drafts.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="px-1 text-xs font-medium text-text-3">
                  {copy.board.drafts(drafts.length)}
                </h3>
                <ul aria-label={copy.board.drafts(drafts.length)}>
                  {drafts.map((card) => (
                    <DraftRow key={`${card.repository.slug}#${card.number}`} card={card} />
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** A collapsed table of the PRs merged or closed in the last 7 days. */
function MergedOrClosed({ cards }: { cards: Card[] }) {
  if (cards.length === 0) return null;
  const columns = copy.board.mergedOrClosedColumns;
  return (
    <details className="group mt-4 rounded-lg border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-2">
        <ChevronRight
          aria-hidden="true"
          className="size-4 transition-transform group-open:rotate-90"
        />
        {copy.board.mergedOrClosed}
        <span className="text-text-3 tabular-nums">{cards.length}</span>
      </summary>
      <table className="w-full border-t border-divider text-[13px]">
        <thead className="text-left text-text-3">
          <tr>
            <th className="px-3 py-1.5 font-medium">{columns.pullRequest}</th>
            <th className="px-3 py-1.5 font-medium">{columns.author}</th>
            <th className="px-3 py-1.5 font-medium">{columns.outcome}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {cards.map((card) => (
            <tr key={`${card.repository.slug}#${card.number}`}>
              <td className="px-3 py-1.5">
                <Link
                  to="/pr/$repo/$number"
                  params={{ repo: card.repository.slug, number: String(card.number) }}
                  className="font-medium text-text no-underline hover:underline"
                >
                  {card.title}
                </Link>{' '}
                <span className="font-mono text-text-3">{copy.board.number(card.number)}</span>
              </td>
              <td className="px-3 py-1.5">{authorName(card.author)}</td>
              <td className="px-3 py-1.5 text-text-2">
                {bannerText(card.nextStep, stepContext(card.author))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
