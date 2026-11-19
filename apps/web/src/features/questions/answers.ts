// Saving answers to the reviewer's questions: one signed request for all of them (S-08-T1).
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { copy } from '@/copy/index.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import type { AnswerConflict, DecisionResult, QuestionView } from '@/lib/api-types.ts';
import { applyResult } from '@/features/findings/decisions.ts';
import { prKeys, prPath } from '@/features/pr/queries.ts';

/** A draft answer: a picked option, or an own text that wins over it. */
export type DraftAnswer = { option: number | null; ownText: string };

export type SaveAnswersInput = {
  answers: { question: QuestionView; draft: DraftAnswer }[];
  signedBy: string;
  signerName: string;
};

/** Who answered the questions of an `answer_conflict` in the meantime, by name. */
export function answerConflictNames(error: ApiError): string[] {
  const conflicts = (error.params.conflicts ?? []) as AnswerConflict[];
  return [...new Set(conflicts.flatMap((c) => (c.answer ? [c.answer.signedBy.name] : [])))];
}

export function useSaveAnswers(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveAnswersInput) =>
      apiRequest<DecisionResult>(`${prPath(repo, number)}/answers`, {
        method: 'POST',
        body: {
          signedBy: input.signedBy,
          answers: input.answers.map(({ question, draft }) => ({
            questionId: question.id,
            ...(draft.ownText.trim()
              ? { ownText: draft.ownText.trim() }
              : { option: draft.option }),
            expectedAnswerId: question.answer?.id ?? null,
          })),
        },
      }),
    onSuccess: (result, input) => {
      applyResult(queryClient, repo, number, result);
      toast.success(copy.questions.saved(input.answers.length), {
        description: copy.questions.signed(input.signerName),
      });
    },
    onError: (error) => {
      // Someone answered in the meantime: show their answers.
      if (error instanceof ApiError && error.code === 'answer_conflict') {
        void queryClient.invalidateQueries({ queryKey: prKeys.findings(repo, number) });
      }
    },
  });
}
