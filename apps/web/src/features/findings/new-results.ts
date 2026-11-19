// S-08-T8 (FR-044): the findings list stays on the round the reader is looking at. A newer round's
// results (new findings or fix checks) wait behind "View new results"; changes within the shown
// round (decisions, opinions, answers) show at once. The banner, checklist and stepper come from
// the PR view and are not held back.
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { isActiveStatus, type FindingsResponse, type RunStatus } from '@/lib/api-types.ts';
import { prKeys } from '@/features/pr/queries.ts';

/** Whether `next` shows the same round's results as `shown` (or `shown` had none yet). */
const sameResults = (shown: FindingsResponse, next: FindingsResponse) =>
  shown.resultsRound === null || shown.resultsRound.id === next.resultsRound?.id;

/**
 * The findings answer to show, and a newer round's answer while it waits. `show` switches to it.
 */
export function usePinnedResults(latest: FindingsResponse | undefined) {
  const [shown, setShown] = useState(latest);
  // Adjusting state while rendering, as React suggests for a changed input: no effect needed.
  if (latest && latest !== shown && (!shown || sameResults(shown, latest))) setShown(latest);
  const current = shown ?? latest;
  const newer = latest && current && latest !== current ? latest : null;
  return { shown: current, newer, show: () => setShown(latest) };
}

/**
 * Refetches the findings when the PR's latest round stops running, so its results reach the
 * "View new results" strip even without a live event.
 */
export function useFetchResultsWhenRoundEnds(repo: string, number: string, status?: RunStatus) {
  const queryClient = useQueryClient();
  const previous = useRef(status);
  useEffect(() => {
    const wasActive = isActiveStatus(previous.current);
    previous.current = status;
    if (wasActive && !isActiveStatus(status)) {
      void queryClient.invalidateQueries({ queryKey: prKeys.findings(repo, number) });
    }
  }, [queryClient, repo, number, status]);
}
