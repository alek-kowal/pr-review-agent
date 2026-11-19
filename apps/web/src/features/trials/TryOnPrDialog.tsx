import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, FlaskConical, GitPullRequest } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { copy } from '@/copy/index.ts';
import { boardQuery } from '@/features/board/queries.ts';
import { ApiError } from '@/lib/api.ts';
import type {
  BoardCard,
  BoardResponse,
  InstructionDetailResponse,
  InstructionVersionView,
} from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { cn } from '@/lib/utils.ts';
import { useStartTrial } from './queries.ts';

const t = copy.trials.tryDialog;

/** The draft a trial runs as run B, and the repository a repository file belongs to. */
export type TrialTarget = {
  fileKey: string;
  /** Set for a repository file: only its repository's PRs are offered. */
  repositorySlug: string | null;
  draftId: number;
  draftVersion: number;
};

/** The open PRs on the board; a repository file offers only its repository's PRs. */
function candidates(board: BoardResponse | undefined, target: TrialTarget) {
  if (!board) return [];
  const { lanes } = board;
  const cards: BoardCard[] = [
    ...lanes.not_reviewed.cards,
    ...lanes.not_reviewed.drafts,
    ...lanes.agents_working.cards,
    ...lanes.action_needed.cards,
    ...lanes.ready_to_merge.cards,
  ];
  return cards.filter(
    (card) => target.repositorySlug === null || card.repository.slug === target.repositorySlug,
  );
}

const keyOf = (card: Pick<BoardCard, 'repository' | 'number'>) =>
  `${card.repository.slug}#${card.number}`;

/**
 * "Try on a PR…" (S-22-T8, FR-080): pick an open PR and start a trial of the saved draft. The trial
 * is unsigned ("Started by hand") and opens its Compare page.
 */
export function TryOnPrDialog({
  detail,
  draft,
}: {
  detail: InstructionDetailResponse;
  draft: InstructionVersionView;
}) {
  const [open, setOpen] = useState(false);
  const target: TrialTarget = {
    fileKey: detail.file.fileKey,
    repositorySlug:
      detail.file.scope === 'repository' ? (detail.file.repository?.slug ?? null) : null,
    draftId: draft.id,
    draftVersion: draft.version,
  };
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <FlaskConical aria-hidden="true" />
        {t.open}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {/* Mounted per open, so each opening starts with no PR picked and no old error. */}
          {open && <TryOnPrForm target={target} onCancel={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The dialog's form: pick an open PR and start the trial of `target`'s draft. */
export function TryOnPrForm({ target, onCancel }: { target: TrialTarget; onCancel: () => void }) {
  const board = useQuery(boardQuery());
  const prs = candidates(board.data, target);
  const [picked, setPicked] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartTrial();
  const navigate = useNavigate();
  const id = useId();
  const selected = prs.find((card) => keyOf(card) === picked) ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The dialog is portalled, but React bubbles the submit to the editor's own form, whose
    // save would set the tried draft aside.
    event.stopPropagation();
    if (!selected) {
      setError(t.prRequired);
      return;
    }
    setError(null);
    start.mutate(
      {
        pr: { repo: selected.repository.slug, number: selected.number },
        instructionDraft: target.draftId,
      },
      {
        onSuccess: (trial) =>
          void navigate({
            to: '/settings/experiments/$id',
            params: { id: String(trial.trial.id) },
          }),
        onError: (failure) =>
          setError(errorText(failure instanceof ApiError ? failure.code : 'http_error')),
      },
    );
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t.title(target.fileKey, target.draftVersion)}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {t.prLabel}
        </label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={pickerOpen}
              aria-invalid={error && !selected ? true : undefined}
              className="w-full justify-between font-normal"
            >
              <span className={cn('truncate', !selected && 'text-muted-foreground')}>
                {selected
                  ? t.pr(selected.repository.slug, selected.number, selected.title)
                  : t.pickPr}
              </span>
              <ChevronsUpDown aria-hidden="true" className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
            <Command label={t.search}>
              <CommandInput placeholder={t.search} />
              <CommandList>
                <CommandEmpty>{prs.length === 0 ? t.none : t.noMatch}</CommandEmpty>
                <CommandGroup>
                  {prs.map((card) => (
                    <CommandItem
                      key={keyOf(card)}
                      value={`${keyOf(card)} ${card.title}`}
                      onSelect={() => {
                        setPicked(keyOf(card));
                        setPickerOpen(false);
                      }}
                    >
                      <Check
                        aria-hidden="true"
                        className={cn(keyOf(card) === picked ? 'opacity-100' : 'opacity-0')}
                      />
                      <GitPullRequest aria-hidden="true" className="text-text-3" />
                      <span className="truncate">
                        {t.pr(card.repository.slug, card.number, card.title)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" disabled={start.isPending}>
          {start.isPending ? t.starting : t.start}
        </Button>
      </DialogFooter>
    </form>
  );
}
