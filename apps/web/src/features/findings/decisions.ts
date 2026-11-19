// Deciding findings and undoing a decision: the requests, the caches they refresh and the toasts.
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Decision } from '@pra/core';
import { copy } from '@/copy/index.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import type {
  DecideResponse,
  DecisionConflict,
  DecisionResult,
  FindingView,
  PrView,
} from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { boardKeys } from '@/features/board/queries.ts';
import { prKeys } from '@/features/pr/queries.ts';

export type DecideInput = {
  findings: FindingView[];
  /** The version of each finding the person saw; a finding left out sends its current one. */
  expectedVersions?: Readonly<Record<number, number>>;
  decision: Decision;
  reason: string;
  signedBy: string;
  /** For the toast: "Signed by Kasia." */
  signerName: string;
  /** Implement only: start the implementer under the same signature (S-13-T5). */
  withAgent?: boolean;
};

const prPath = (repo: string, number: string) =>
  `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}`;

/**
 * Shows the refreshed findings, banner and checklist at once, then refetches the PR view and the
 * board so the lane follows. Answers and reviews answer with the same shape.
 */
export function applyResult(
  queryClient: QueryClient,
  repo: string,
  number: string,
  result: DecisionResult,
) {
  queryClient.setQueryData(prKeys.findings(repo, number), result.findings);
  queryClient.setQueryData<PrView>(
    prKeys.view(repo, number),
    (old) => old && { ...old, nextStep: result.nextStep, checklist: result.checklist },
  );
  void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
  void queryClient.invalidateQueries({ queryKey: boardKeys.all });
}

/** Who decided the findings of a `decision_conflict` in the meantime, by name. */
export function conflictNames(error: ApiError): string[] {
  const conflicts = (error.params.conflicts ?? []) as DecisionConflict[];
  const names = conflicts.flatMap((c) => (c.decision ? [c.decision.signedBy.name] : []));
  return [...new Set(names)];
}

/** Undo needs no signature: the batch keeps its signer and the time it was undone. */
export async function undoDecision(
  queryClient: QueryClient,
  repo: string,
  number: string,
  batchId: number,
): Promise<void> {
  try {
    const result = await apiRequest<DecisionResult>(`/api/decision-batches/${batchId}/undo`, {
      method: 'POST',
    });
    applyResult(queryClient, repo, number, result);
    toast.success(copy.decisions.toast.undone);
  } catch (error) {
    toast.error(copy.decisions.toast.undoFailed, {
      description: errorText(error instanceof ApiError ? error.code : 'http_error'),
    });
    void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
  }
}

/** One signed decision on one or more findings; success offers Undo in a toast. */
export function useDecide(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DecideInput) =>
      apiRequest<DecideResponse>(`${prPath(repo, number)}/decisions`, {
        method: 'POST',
        body: {
          findingIds: input.findings.map((f) => f.id),
          decision: input.decision,
          ...(input.reason.trim() ? { reason: input.reason.trim() } : {}),
          signedBy: input.signedBy,
          expectedVersions: Object.fromEntries(
            input.findings.map((f) => [f.id, input.expectedVersions?.[f.id] ?? f.version]),
          ),
          ...(input.withAgent ? { withAgent: true } : {}),
        },
      }),
    onSuccess: (result, input) => {
      applyResult(queryClient, repo, number, result);
      const signed = copy.decisions.toast.signed(input.signerName);
      toast(copy.decisions.toast.decided(input.decision, input.findings.length), {
        description: result.implementerRunId
          ? `${signed} ${copy.implementer.startedWithDecision}`
          : signed,
        // Long enough to notice a wrong decision and undo it.
        duration: 10_000,
        // Decisions that started the implementer are not undone here: Cancel the run first.
        ...(result.implementerRunId
          ? {}
          : {
              action: {
                label: copy.decisions.toast.undo,
                onClick: () => void undoDecision(queryClient, repo, number, result.batchId),
              },
            }),
      });
    },
    onError: (error) => {
      // Someone decided in the meantime: show the findings as they are now.
      if (error instanceof ApiError && error.code === 'decision_conflict') {
        void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      }
    },
  });
}
