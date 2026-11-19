import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { copy } from '@/copy/index.ts';
import { dateTime } from '@/copy/format.ts';
import { ApiError } from '@/lib/api.ts';
import type { QuestionView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { EmptyTab } from '@/features/pr/EmptyTab.tsx';
import { findingsQuery } from '@/features/pr/queries.ts';
import type { PrTabProps } from '@/features/pr/tabs.ts';
import { SignatureField } from '@/features/signature/SignatureField.tsx';
import { useSignature } from '@/features/signature/use-signature.ts';
import { answerConflictNames, useSaveAnswers, type DraftAnswer } from './answers.ts';

const EMPTY: DraftAnswer = { option: null, ownText: '' };
const hasAnswer = (draft: DraftAnswer | undefined) =>
  !!draft && (draft.ownText.trim() !== '' || draft.option !== null);

/**
 * The reviewer's questions (FR-034): a RadioGroup per open question with the recommended option
 * marked and an own answer, then one signature and "Save N answers" for all of them. Answered
 * questions show the answer and who gave it.
 */
export function QuestionsTab({ repo, number, view }: PrTabProps) {
  const query = useQuery(findingsQuery(repo, number));
  if (query.isPending) return <p className="text-text-3">{copy.findings.loading}</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-bad">
        {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
      </p>
    );
  }
  const { questions } = query.data;
  if (questions.length === 0) return <EmptyTab text={copy.pr.empty.questions} />;
  const readOnly = view.pullRequest.state !== 'open';
  return <QuestionList repo={repo} number={number} questions={questions} readOnly={readOnly} />;
}

type ListProps = { repo: string; number: string; questions: QuestionView[]; readOnly: boolean };

function QuestionList({ repo, number, questions, readOnly }: ListProps) {
  const signature = useSignature();
  const save = useSaveAnswers(repo, number);
  const [drafts, setDrafts] = useState<Record<number, DraftAnswer>>({});
  const [error, setError] = useState<string | null>(null);
  const open = questions.filter((q) => !q.answer);
  const ready = open.filter((q) => hasAnswer(drafts[q.id]));
  const canSave =
    !readOnly && open.length > 0 && ready.length === open.length && !!signature.signedBy;

  const setDraft = (id: number, patch: Partial<DraftAnswer>) => {
    setDrafts((all) => ({ ...all, [id]: { ...(all[id] ?? EMPTY), ...patch } }));
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave || save.isPending || !signature.signedBy) return;
    const signer = signature.members.find((m) => m.id === signature.signedBy);
    try {
      await save.mutateAsync({
        answers: open.map((question) => ({ question, draft: drafts[question.id]! })),
        signedBy: signature.signedBy,
        signerName: signer?.name ?? '',
      });
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : 'http_error';
      return setError(
        failure instanceof ApiError && code === 'answer_conflict'
          ? copy.questions.conflict(answerConflictNames(failure))
          : errorText(code),
      );
    }
    signature.remember();
    setDrafts({});
  };

  return (
    <form
      className="flex flex-col gap-3"
      data-testid="questions-tab"
      onSubmit={(e) => void submit(e)}
    >
      {questions.map((question) => (
        <QuestionCard
          key={question.id}
          question={question}
          draft={drafts[question.id] ?? EMPTY}
          disabled={readOnly}
          onChange={(patch) => setDraft(question.id, patch)}
        />
      ))}
      {readOnly && open.length > 0 && (
        <p className="text-sm text-text-3">{copy.questions.readOnly}</p>
      )}
      {!readOnly && open.length > 0 && (
        <div
          className="sticky bottom-3 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm"
          data-answers
        >
          <SignatureField signature={signature} className="min-w-[220px] flex-1" />
          <div className="flex flex-col items-end gap-1">
            <Button type="submit" disabled={!canSave || save.isPending}>
              {save.isPending ? copy.questions.saving : copy.questions.save(ready.length)}
            </Button>
            {!canSave && <span className="text-xs text-text-3">{copy.questions.answerEvery}</span>}
          </div>
          {error && (
            <p role="alert" className="w-full text-sm text-bad">
              {error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

type CardProps = {
  question: QuestionView;
  draft: DraftAnswer;
  disabled: boolean;
  onChange: (patch: Partial<DraftAnswer>) => void;
};

function QuestionCard({ question, draft, disabled, onChange }: CardProps) {
  const titleId = useId();
  const ownId = useId();
  const own = draft.ownText.trim() !== '';
  const picked = own || draft.option === null ? '' : String(draft.option);
  return (
    <section
      aria-labelledby={titleId}
      data-question={question.id}
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-start gap-3">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-inset text-xs font-semibold">
          {copy.questions.label(question.ordinal)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="m-0 text-base font-semibold">
            {question.text}
          </h3>
          {question.why && <p className="m-0 mt-1 text-sm text-text-2">{question.why}</p>}
        </div>
      </div>
      {question.answer ? (
        <div className="mt-3 ml-10 text-sm" data-answer>
          <span className="font-medium">
            {copy.questions.answeredBy(question.answer.signedBy.name)}
          </span>{' '}
          <span className="text-text-3">{dateTime(question.answer.savedAt)}</span>
          <div className="mt-0.5">
            {question.answer.text}
            {question.answer.option === null && (
              <span className="text-text-3"> · {copy.questions.ownAnswerTag}</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 ml-10 grid gap-2">
          <RadioGroup
            aria-label={copy.questions.options}
            value={picked}
            disabled={disabled}
            onValueChange={(value) => onChange({ option: Number(value), ownText: '' })}
            className="gap-1.5"
          >
            {question.options.map((option, index) => {
              const id = `${titleId}-o${index}`;
              return (
                <label
                  key={index}
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-inset has-[[data-state=checked]]:border-primary"
                >
                  <RadioGroupItem id={id} value={String(index)} />
                  <span className="flex-1">{option}</span>
                  {question.recommended === index && (
                    <span className="inline-flex items-center gap-1 text-xs text-text-3">
                      <Sparkles className="size-3" aria-hidden />
                      {copy.questions.recommended}
                    </span>
                  )}
                </label>
              );
            })}
          </RadioGroup>
          <label htmlFor={ownId} className="sr-only">
            {copy.questions.ownAnswer}
          </label>
          <Textarea
            id={ownId}
            rows={1}
            disabled={disabled}
            value={draft.ownText}
            placeholder={copy.questions.ownAnswerPlaceholder}
            onChange={(e) => onChange({ ownText: e.target.value })}
            className="min-h-9"
          />
        </div>
      )}
    </section>
  );
}
