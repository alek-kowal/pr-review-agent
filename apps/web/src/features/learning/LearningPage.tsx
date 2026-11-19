import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, FlaskConical, Pencil, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.tsx';
import { copy } from '@/copy/index.ts';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { TryOnPrForm, type TrialTarget } from '@/features/trials/TryOnPrDialog.tsx';
import { ApiError } from '@/lib/api.ts';
import type { LessonCandidateView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import {
  candidatesQuery,
  useAcceptCandidate,
  useEditCandidate,
  useLessonDraft,
  useRejectCandidate,
} from './queries.ts';

const t = copy.learning;

const failureText = (failure: unknown, candidate?: LessonCandidateView) => {
  if (!(failure instanceof ApiError)) return errorText('http_error');
  if (failure.code === 'needs_more_prs' && candidate) {
    return t.needsMorePrs(candidate.prCount, candidate.need);
  }
  return errorText(failure.code);
};

/**
 * Settings → Learning (S-23-T5, FR-083–086): the analyst's lesson candidates. Edit and "Try on a
 * PR…" are unsigned; Reject and Accept are signed. Accepted lessons show their lessons.md version.
 */
export function LearningPage() {
  const query = useQuery(candidatesQuery());
  const all = query.data?.candidates ?? [];
  const open = all.filter((c) => c.status === 'proposed');
  const accepted = all.filter((c) => c.status === 'accepted');
  const rejected = all.filter((c) => c.status === 'rejected');

  return (
    <SettingsPage title={copy.settings.pages.learning} affects={t.affects}>
      {query.isError ? (
        <p role="alert" className="text-bad">
          {t.loadFailed}
        </p>
      ) : query.isPending ? (
        <p className="text-text-3">{t.loading}</p>
      ) : (
        <>
          <section aria-labelledby="learning-candidates" className="flex flex-col gap-3">
            <div>
              <h2 id="learning-candidates" className="font-heading text-base font-semibold">
                {t.candidates}
              </h2>
              <p className="text-sm text-text-3">{t.candidatesHint}</p>
            </div>
            {open.length === 0 ? (
              <p className="text-sm text-text-3">{t.noCandidates}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {open.map((candidate) => (
                  <li key={candidate.id}>
                    <CandidateCard candidate={candidate} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="learning-accepted" className="flex flex-col gap-3">
            <h2 id="learning-accepted" className="font-heading text-base font-semibold">
              {t.accepted}
            </h2>
            {accepted.length === 0 ? (
              <p className="text-sm text-text-3">{t.noAccepted}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {accepted.map((lesson) => (
                  <li
                    key={lesson.id}
                    className="rounded-lg border border-border bg-surface px-4 py-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{lesson.title}</span>
                      {lesson.lessonsVersion !== null && (
                        <Badge variant="outline" className="font-mono">
                          {t.version(lesson.lessonsVersion)}
                        </Badge>
                      )}
                      <span className="text-text-3">{lesson.repo}</span>
                    </div>
                    <p className="mt-1 text-text-2">{lesson.text}</p>
                    <p className="mt-1 text-xs text-text-3">{t.acceptedBy(lesson.decidedBy)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {rejected.length > 0 && (
            <section aria-labelledby="learning-rejected" className="flex flex-col gap-2">
              <h2 id="learning-rejected" className="font-heading text-base font-semibold">
                {t.rejected}
              </h2>
              <ul className="flex flex-col gap-1 text-sm">
                {rejected.map((c) => (
                  <li key={c.id} className="text-text-2">
                    <span className="font-medium">{c.title}</span>
                    <span className="text-text-3">
                      {' '}
                      — {t.rejectedBy(c.decidedBy, c.rejectReason)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </SettingsPage>
  );
}

function CandidateCard({ candidate }: { candidate: LessonCandidateView }) {
  const [editing, setEditing] = useState(false);
  const short = candidate.prCount < candidate.need;
  const countId = useId();
  return (
    <article
      aria-label={candidate.title}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3"
    >
      {editing ? (
        <EditForm candidate={candidate} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{candidate.title}</h3>
            {candidate.editedAt && <Badge variant="outline">{t.editedByHand}</Badge>}
          </div>
          <p className="text-sm text-text-2">{candidate.text}</p>
        </>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-3">
        <span>{candidate.repo}</span>
        <span id={countId}>
          {short ? t.needsMorePrs(candidate.prCount, candidate.need) : t.prCount(candidate.prCount)}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          {t.sources}
          {candidate.sources.map((s) => (
            <Link
              key={`${s.repo}#${s.number}`}
              to="/pr/$repo/$number"
              params={{ repo: s.repo, number: String(s.number) }}
              title={s.title}
              className="font-mono text-brand-text hover:underline"
            >
              {t.source(s.repo, s.number)}
            </Link>
          ))}
        </span>
      </div>
      {!editing && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" />
            {t.edit.open}
          </Button>
          <TryLesson candidate={candidate} />
          <RejectDialog candidate={candidate} />
          {short ? (
            <Tooltip>
              <TooltipTrigger asChild>
                {/* A disabled button gets no pointer events, so the span carries the Tooltip. */}
                <span tabIndex={0} aria-describedby={countId} className="inline-flex">
                  <Button type="button" size="sm" disabled>
                    <Check aria-hidden="true" />
                    {t.accept.open}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t.needsMorePrs(candidate.prCount, candidate.need)}</TooltipContent>
            </Tooltip>
          ) : (
            <AcceptDialog candidate={candidate} />
          )}
        </div>
      )}
    </article>
  );
}

function EditForm({ candidate, onDone }: { candidate: LessonCandidateView; onDone: () => void }) {
  const [title, setTitle] = useState(candidate.title);
  const [text, setText] = useState(candidate.text);
  const [error, setError] = useState<string | null>(null);
  const edit = useEditCandidate();
  const id = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !text.trim()) {
      setError(t.edit.required);
      return;
    }
    setError(null);
    edit.mutate(
      { id: candidate.id, body: { title: title.trim(), text: text.trim() } },
      { onSuccess: onDone, onError: (failure) => setError(failureText(failure)) },
    );
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-title`}>{t.edit.title}</Label>
        <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-text`}>{t.edit.text}</Label>
        <Textarea
          id={`${id}-text`}
          value={text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <p className="text-xs text-text-3">{t.edit.hint}</p>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={edit.isPending}>
          {t.edit.save}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t.edit.cancel}
        </Button>
      </div>
    </form>
  );
}

/** "Try on a PR…": saves the lessons.md draft with the lesson, then the S-22 trial dialog. */
function TryLesson({ candidate }: { candidate: LessonCandidateView }) {
  const [target, setTarget] = useState<TrialTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draft = useLessonDraft();
  const open = () => {
    setError(null);
    draft.mutate(candidate.id, {
      onSuccess: (saved) =>
        setTarget({
          fileKey: 'lessons.md',
          repositorySlug: candidate.repo,
          draftId: saved.versionId,
          draftVersion: saved.version,
        }),
      onError: (failure) => setError(failureText(failure)),
    });
  };
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={open} disabled={draft.isPending}>
        <FlaskConical aria-hidden="true" />
        {t.tryOnPr}
      </Button>
      {error && (
        <p role="alert" className="basis-full text-sm text-bad">
          {error}
        </p>
      )}
      <Dialog open={target !== null} onOpenChange={(next) => !next && setTarget(null)}>
        <DialogContent className="sm:max-w-lg">
          {target && <TryOnPrForm target={target} onCancel={() => setTarget(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RejectDialog({ candidate }: { candidate: LessonCandidateView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <X aria-hidden="true" />
        {t.reject.open}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {open && <DecideForm kind="reject" candidate={candidate} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AcceptDialog({ candidate }: { candidate: LessonCandidateView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Check aria-hidden="true" />
        {t.accept.open}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          {open && <DecideForm kind="accept" candidate={candidate} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The signed form of Reject (with a reason) and Accept. */
function DecideForm({
  kind,
  candidate,
  onDone,
}: {
  kind: 'reject' | 'accept';
  candidate: LessonCandidateView;
  onDone: () => void;
}) {
  const signature = useSignature();
  const reject = useRejectCandidate();
  const accept = useAcceptCandidate();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<{ field: 'reason' | 'signature' | null; text: string } | null>(
    null,
  );
  const id = useId();
  const pending = reject.isPending || accept.isPending;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (kind === 'reject' && !reason.trim()) {
      setError({ field: 'reason', text: t.reject.reasonRequired });
      return;
    }
    if (!signature.signedBy) {
      setError({ field: 'signature', text: errorText('signature_required') });
      return;
    }
    setError(null);
    const options = {
      onSuccess: () => {
        signature.remember();
        onDone();
      },
      onError: (failure: unknown) =>
        setError({ field: null, text: failureText(failure, candidate) }),
    };
    const signed = { signedBy: signature.signedBy, text: candidate.text };
    if (kind === 'reject') {
      reject.mutate({ id: candidate.id, body: { ...signed, reason: reason.trim() } }, options);
    } else {
      accept.mutate({ id: candidate.id, body: signed }, options);
    }
  };

  const words = kind === 'reject' ? t.reject : t.accept;
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{words.title(candidate.title)}</DialogTitle>
        <DialogDescription>
          {kind === 'reject' ? t.reject.description : t.accept.description(candidate.repo)}
        </DialogDescription>
      </DialogHeader>
      {kind === 'reject' && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-reason`}>{t.reject.reason}</Label>
          <Textarea
            id={`${id}-reason`}
            value={reason}
            rows={3}
            placeholder={t.reject.reasonPlaceholder}
            aria-invalid={error?.field === 'reason' ? true : undefined}
            aria-describedby={error?.field === 'reason' ? `${id}-error` : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
          {error?.field === 'reason' && (
            <p id={`${id}-error`} className="text-sm text-bad">
              {error.text}
            </p>
          )}
        </div>
      )}
      <SignatureField
        signature={signature}
        error={error?.field === 'signature' ? error.text : null}
      />
      {error?.field === null && (
        <p role="alert" className="text-sm text-bad">
          {error.text}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {words.cancel}
        </Button>
        <Button
          type="submit"
          variant={kind === 'reject' ? 'destructive' : 'default'}
          disabled={pending}
        >
          {words.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
