import { Link } from '@tanstack/react-router';
import { CircleAlert, CircleCheck, CircleDashed, Loader, UserRound } from 'lucide-react';
import type { Tone } from '@pra/core';
import { cn } from 'cn';
import { copy } from '@/copy/index.ts';
import type { BoardCard as Card } from '@/lib/api-types.ts';
import { authorName, shortText, stepContext, whoText } from '@/lib/next-step.ts';
import { CARD_BADGE_SLOTS } from './slots.ts';
import { TONE_TEXT } from './tone.ts';

const TONE_ICON = {
  neutral: CircleDashed,
  working: Loader,
  action: UserRound,
  failed: CircleAlert,
  ready: CircleCheck,
} satisfies Record<Tone, unknown>;

/** The card's title as the link; the link stretches over the whole card. */
function TitleLink({ card, className }: { card: Card; className?: string }) {
  return (
    <Link
      to="/pr/$repo/$number"
      params={{ repo: card.repository.slug, number: String(card.number) }}
      className={cn(
        'text-text no-underline after:absolute after:inset-0 after:rounded-lg after:content-[""] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring',
        className,
      )}
    >
      {card.title}
    </Link>
  );
}

/** How long ago the PR was opened, as of `now` (when the board was fetched). */
function Age({ iso, now }: { iso: string; now: number }) {
  const opened = new Date(iso);
  return (
    <time dateTime={iso} title={copy.board.opened(opened.toLocaleString())}>
      {copy.board.age(now - opened.getTime())}
    </time>
  );
}

function ReasonBadges({ card }: { card: Card }) {
  return (
    <>
      {card.badges.map((badge) => {
        const text = copy.board.badges[badge.code]?.(badge.params);
        return text ? (
          <span
            key={badge.code}
            className="rounded border border-border px-1.5 text-[11px] leading-4 text-text-2"
          >
            {text}
          </span>
        ) : null;
      })}
      {CARD_BADGE_SLOTS.map(({ key, Component }) => (
        <Component key={key} card={card} />
      ))}
    </>
  );
}

/** `#12 · repo · Kasia · 3d`, plus badges. The repository shows only when there are several. */
function CardMeta({
  card,
  showRepository,
  now,
}: {
  card: Card;
  showRepository: boolean;
  now: number;
}) {
  const parts = [
    <span key="n" className="font-mono">
      {copy.board.number(card.number)}
    </span>,
    showRepository && (
      <span key="r" className="truncate">
        {card.repository.slug}
      </span>
    ),
    <span key="a">{authorName(card.author)}</span>,
    <Age key="t" iso={card.openedAt} now={now} />,
  ].filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-text-3">
      {parts.map((part, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">·</span>}
          {part}
        </span>
      ))}
      <span className="flex-1" />
      <ReasonBadges card={card} />
    </div>
  );
}

/**
 * A board card: title; `#number · author · age`; the next step (docs/03 "Simplification pass").
 * Cards drop "usually X (author)"; Ready to merge cards are two lines.
 */
export function BoardCard({
  card,
  showRepository,
  now,
}: {
  card: Card;
  showRepository: boolean;
  /** When the board was fetched; ages count from it. */
  now: number;
}) {
  const step = card.nextStep;
  const context = stepContext(card.author);
  const who = copy.nextStep.quietOnCards.includes(step.who.code) ? '' : whoText(step, context);
  const Icon = TONE_ICON[step.tone];
  const twoLines = step.lane === 'ready_to_merge';
  return (
    <article
      data-state={step.state}
      className="relative flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2.5 hover:border-border-strong"
    >
      <TitleLink card={card} className="line-clamp-2 leading-5 font-medium" />
      <CardMeta card={card} showRepository={showRepository} now={now} />
      {!twoLines && (
        <p className="flex items-start gap-1.5 text-[13px]">
          <Icon
            aria-hidden="true"
            className={cn('mt-0.5 size-3.5 shrink-0', TONE_TEXT[step.tone])}
          />
          <span className="min-w-0">
            <span className="font-medium text-text">{shortText(step, context)}</span>
            {who && <span className="text-text-3"> · {who}</span>}
          </span>
        </p>
      )}
    </article>
  );
}

/** A draft: one line with the title and the author. */
export function DraftRow({ card }: { card: Card }) {
  return (
    <li
      data-state={card.nextStep.state}
      className="relative flex items-baseline gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-inset"
    >
      <TitleLink card={card} className="min-w-0 flex-1 truncate" />
      <span className="whitespace-nowrap text-text-3">{authorName(card.author)}</span>
    </li>
  );
}
