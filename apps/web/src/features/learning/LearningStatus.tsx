// S-23-T6: the learning line in a closed PR's banner and the "Run analyst" header action.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Lightbulb } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { prKeys } from '@/features/pr/queries.ts';
import type { PrSlotProps } from '@/features/pr/slots.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { learningKeys } from './queries.ts';

const t = copy.learning;

/** "Learning: Analyst is running" / "… finished: N candidates" / "… failed" on a closed PR. */
export function LearningBannerLine({ view }: PrSlotProps) {
  const { analysis } = view.learning;
  if (view.pullRequest.state === 'open' || !analysis) return null;
  return (
    <p
      data-testid="learning-line"
      className="flex flex-wrap items-center gap-x-2 text-[13px] text-text-2"
    >
      <span>
        <span className="font-medium">{t.status.label}</span>{' '}
        {analysis.status === 'running'
          ? t.status.running
          : analysis.status === 'finished'
            ? t.status.finished(analysis.candidates ?? 0)
            : t.status.failed}
      </span>
      {analysis.status === 'finished' && (
        <Link to="/settings/learning" className="text-brand-text hover:underline">
          {t.status.openLearning}
        </Link>
      )}
      {analysis.status === 'failed' && analysis.runId !== null && (
        <Link
          to="/runs/$runId"
          params={{ runId: String(analysis.runId) }}
          className="text-brand-text hover:underline"
        >
          {t.status.openRun}
        </Link>
      )}
    </p>
  );
}

function useRunAnalyst(repo: string, number: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiRequest<{ analysisId: number; runId: number }>(
        `/api/prs/${encodeURIComponent(repo)}/${encodeURIComponent(number)}/analyst`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success(t.runAnalyst.started);
      void queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number) });
      void queryClient.invalidateQueries({ queryKey: learningKeys.candidates });
    },
    onError: (error) => {
      toast.error(errorText(error instanceof ApiError ? error.code : 'http_error'));
    },
  });
}

/** "Run analyst" in the header of every closed PR: unsigned, recorded "by hand". */
export function RunAnalystHeaderAction({ repo, number, view }: PrSlotProps) {
  const run = useRunAnalyst(repo, number);
  if (view.pullRequest.state === 'open') return null;
  const running = view.learning.analysis?.status === 'running';
  return (
    <Button
      size="sm"
      variant="outline"
      title={t.runAnalyst.title}
      disabled={running || run.isPending}
      onClick={() => run.mutate()}
    >
      <Lightbulb aria-hidden="true" className="size-[13px]" />
      {t.runAnalyst.button}
    </Button>
  );
}
