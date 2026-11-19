import { ChevronDown, Play } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { LEVEL_NUMBERS, type LevelNumber } from '@pra/core';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { copy } from '@/copy/index.ts';
import { shortSha } from '@/copy/nextStep.ts';
import { levelNames } from '@/copy/repositories.ts';
import type { MainActionProps, PrSlotProps } from '@/features/pr/slots.ts';
import { useOpenStartReview } from './open-start-review.ts';
import { startBlockedReason, useStartReview } from './start-review.ts';

const t = copy.startReview;

/**
 * "Start review ▾" (spec: `prototype/js/pr.js` `StartReview`): a popover with the level for this
 * round, marked against the repository default, and the start button. A start is unsigned and
 * always begins a new chain at round 1.
 */
export function StartReview({
  repo,
  number,
  view,
  primary = false,
  fromPalette = false,
}: PrSlotProps & {
  primary?: boolean;
  /** The command palette's "Start review on this PR" opens this one (S-17-T5). */
  fromPalette?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<LevelNumber>(view.head.level.next);
  const openFromPalette = useCallback(() => {
    setLevel(view.head.level.next);
    setOpen(true);
  }, [view.head.level.next]);
  useOpenStartReview(openFromPalette, fromPalette);
  const start = useStartReview(repo, number);
  const blocked = startBlockedReason(view);
  const selectId = useId();
  const { pullRequest: pr } = view;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setLevel(view.head.level.next);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant={primary ? 'default' : 'outline'} data-start-review>
          <Play aria-hidden="true" className="size-[13px]" />
          {t.button}
          <ChevronDown aria-hidden="true" className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[300px] gap-2.5 p-3">
        <div className="grid gap-1">
          <Label htmlFor={selectId}>{t.levelLabel}</Label>
          <Select
            value={String(level)}
            onValueChange={(value) => setLevel(Number(value) as LevelNumber)}
          >
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVEL_NUMBERS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {t.level(n, levelNames[n] ?? '', n === view.head.level.repositoryDefault)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="secondary"
          className="w-full"
          disabled={blocked !== null || start.isPending}
          onClick={() => start.mutate(level, { onSuccess: () => setOpen(false) })}
        >
          <Play aria-hidden="true" className="size-[13px]" />
          {t.button}
        </Button>
        {blocked && (
          <p data-testid="start-review-blocked" className="text-xs text-warn">
            {blocked}
          </p>
        )}
        <p className="text-xs text-text-3">
          {t.hint(shortSha(pr.headSha))}
          {pr.isFork && ` ${t.forkHint}`}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** In the header of every open PR. */
export function StartReviewHeaderAction(props: PrSlotProps) {
  return props.view.pullRequest.state === 'open' ? <StartReview {...props} fromPalette /> : null;
}

/** The banner's main action for `start_review` (new commits, rounds used, not reviewed). */
export function StartReviewMainAction(props: MainActionProps) {
  return <StartReview {...props} primary />;
}
