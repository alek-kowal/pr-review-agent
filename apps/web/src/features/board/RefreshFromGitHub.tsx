import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';
import { pollErrorText } from '@/features/integrations/poll-error.ts';
import { integrationsQuery, usePollNow } from '@/features/integrations/queries.ts';
import { useGitHubReadOnly } from '@/features/shell/status-query.ts';
import { ApiError } from '@/lib/api.ts';
import { errorText } from '@/lib/reasons.ts';
import { pollBusy, type Asked } from './poll-busy.ts';

const t = copy.board.refresh;

const BUSY_REFETCH_MS = 2_000;
/** Otherwise often enough that "Updated …" and a scheduled poll's result stay current. */
const IDLE_REFETCH_MS = 60_000;

/**
 * Without the GitHub App (CONNECT): the board's "Refresh from GitHub" runs Poll now, says when the
 * last poll ended and, if it failed, why. Off while a poll runs. Nothing in App mode, where
 * webhooks keep the board current.
 */
export function RefreshFromGitHub({ className }: { className?: string }) {
  const readOnly = useGitHubReadOnly();
  const pollNow = usePollNow();
  const [asked, setAsked] = useState<Asked | null>(null);
  const integrations = useQuery({
    ...integrationsQuery(),
    enabled: readOnly,
    refetchInterval: (query) => {
      const poller = query.state.data?.github.poller;
      return poller && pollBusy(poller, asked, query.state.dataUpdatedAt)
        ? BUSY_REFETCH_MS
        : IDLE_REFETCH_MS;
    },
  });
  const poller = integrations.data?.github.poller;
  if (!readOnly || !poller) return null;

  const now = integrations.dataUpdatedAt;
  const busy = pollNow.isPending || pollBusy(poller, asked, now);
  const finished = poller.lastFinishedAt;
  return (
    <div
      role="group"
      aria-label={t.label}
      className={cn('flex flex-col items-end gap-0.5 text-xs text-text-3', className)}
    >
      <div className="flex items-center gap-2">
        <span>{finished ? t.updated(now - Date.parse(finished)) : t.never}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setAsked({ at: Date.now(), finishedBefore: poller.lastFinishedAt });
            pollNow.mutate(undefined, { onError: () => setAsked(null) });
          }}
        >
          <RefreshCw aria-hidden="true" className={cn(busy && 'animate-spin')} />
          {busy ? t.refreshing : t.button}
        </Button>
      </div>
      {pollNow.isError ? (
        <p role="alert" className="text-bad">
          {t.failedToQueue(
            errorText(pollNow.error instanceof ApiError ? pollNow.error.code : 'http_error'),
          )}
        </p>
      ) : (
        poller.lastError && (
          <p className="text-bad">{t.lastError(pollErrorText(poller.lastError))}</p>
        )
      )}
    </div>
  );
}
