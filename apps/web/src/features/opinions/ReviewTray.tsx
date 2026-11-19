// S-08-T6: the review tray (spec: `prototype/js/findings.js` `FindingsTab`, dialog
// `prototype/js/dialogs.js` `saveReview`). Drafted opinions are saved as one signed review.
import { Check, MessageSquareText } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import type { FindingView, PrView } from '@/lib/api-types.ts';
import { authorName } from '@/lib/next-step.ts';
import { errorText } from '@/lib/reasons.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { useReviewDraft, type ReviewDraft } from './draft.ts';
import { OPINION_ICONS } from './opinion-ui.ts';
import { useSaveReview } from './reviews.ts';

const t = copy.opinions;

type Props = { repo: string; number: string; view: PrView; findings: FindingView[] };

/** The drafted opinions of findings still on the list, in the list's order. */
function draftOf(draft: ReviewDraft, findings: FindingView[]): ReviewDraft {
  return new Map(findings.flatMap((f) => (draft.has(f.id) ? [[f.id, draft.get(f.id)!]] : [])));
}

/** "Your review: 3 opinions" with Discard and Save review…; hidden while nothing is drafted. */
export function ReviewTray({ repo, number, view, findings }: Props) {
  const { draft: all, clear } = useReviewDraft(repo, number);
  const [saving, setSaving] = useState(false);
  const draft = draftOf(all, findings);
  if (draft.size === 0) return null;
  const values = [...draft.values()];
  const worth = values.filter((o) => o.value === 'worth').length;

  return (
    <div
      role="region"
      aria-label={t.tray.label}
      data-testid="review-tray"
      className="sticky bottom-4 z-30 flex flex-wrap items-center gap-2 rounded-[10px] border border-brand bg-surface py-2 pr-2.5 pl-3.5 shadow-md"
    >
      <MessageSquareText aria-hidden="true" className="size-4 text-brand-text" />
      <span className="text-sm">
        <span className="font-semibold">{t.tray.title(draft.size)}</span>{' '}
        <span className="text-text-3">{t.tray.counts(worth, draft.size - worth)}</span>
      </span>
      <span className="flex-1" />
      <Button type="button" variant="ghost" size="sm" onClick={clear}>
        {t.tray.discard}
      </Button>
      <Button type="button" size="sm" onClick={() => setSaving(true)}>
        <Check aria-hidden="true" />
        {t.tray.save}
      </Button>
      <Dialog open={saving} onOpenChange={setSaving}>
        <DialogContent className="sm:max-w-lg">
          {/* Mounted per open, so each opening starts from the last signer and no old error. */}
          <SaveReviewForm
            repo={repo}
            number={number}
            view={view}
            findings={findings}
            draft={draft}
            onCancel={() => setSaving(false)}
            onDone={() => {
              setSaving(false);
              clear();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SaveReviewForm({
  repo,
  number,
  view,
  findings,
  draft,
  onCancel,
  onDone,
}: Omit<Props, 'findings'> & {
  findings: FindingView[];
  draft: ReviewDraft;
  onCancel: () => void;
  onDone: () => void;
}) {
  const save = useSaveReview(repo, number);
  const signature = useSignature();
  const [error, setError] = useState<string | null>(null);
  const author = authorName(view.author);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const signedBy = signature.signedBy;
    if (!signedBy) return setError(copy.signature.required);
    setError(null);
    save.mutate(
      { draft, signedBy },
      {
        onSuccess: (result) => {
          signature.remember();
          toast.success(t.toast.saved(result.review.signedBy.name), {
            description: t.toast.savedHint(draft.size, number, author),
          });
          onDone();
        },
        onError: (failure) =>
          setError(errorText(failure instanceof ApiError ? failure.code : 'http_error')),
      },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label={t.dialog.title}>
      <DialogHeader>
        <DialogTitle>{t.dialog.title}</DialogTitle>
        <DialogDescription>{t.dialog.description(author)}</DialogDescription>
      </DialogHeader>
      <ul className="grid gap-2" data-testid="review-opinions">
        {findings
          .filter((f) => draft.has(f.id))
          .map((f) => {
            const opinion = draft.get(f.id)!;
            const Icon = OPINION_ICONS[opinion.value];
            return (
              <li key={f.id} className="flex items-start gap-2 text-sm">
                <span
                  className={`inline-flex w-[150px] shrink-0 items-center gap-1 font-medium whitespace-nowrap ${
                    opinion.value === 'worth' ? 'text-ok' : 'text-text-2'
                  }`}
                >
                  <Icon aria-hidden="true" className="size-[13px]" />
                  {t.values[opinion.value]}
                </span>
                <span className="min-w-0">
                  {f.title}
                  {opinion.comment.trim() && (
                    <span className="block text-text-3">{t.comment(opinion.comment.trim())}</span>
                  )}
                </span>
              </li>
            );
          })}
      </ul>
      <SignatureField
        signature={{
          ...signature,
          setSignedBy: (id) => {
            signature.setSignedBy(id);
            setError(null);
          },
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t.dialog.keepEditing}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          <Check aria-hidden="true" />
          {save.isPending ? t.dialog.saving : t.dialog.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
