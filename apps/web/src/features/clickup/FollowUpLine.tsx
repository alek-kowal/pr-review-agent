import { ExternalLink } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import type { FollowUpView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import type { FindingSlotProps } from '@/features/findings/slots.ts';

const whyText = (error: FollowUpView['error']): string =>
  error ? (copy.clickup.followUp.why[error.code] ?? errorText(error.code)) : errorText('unknown');

/**
 * Action slot (S-06-T5): a finding deferred to ClickUp shows its follow-up task, that the task is
 * being created, or why there is none. Other findings show nothing.
 */
export function FollowUpLine({ finding }: FindingSlotProps) {
  const followUp = finding.decision?.followUp;
  if (!followUp) return null;
  const t = copy.clickup.followUp;

  return (
    <p data-testid="follow-up" className="flex flex-wrap items-center gap-1 text-sm text-text-2">
      <span className="font-medium text-text">{t.deferred}</span>
      <span aria-hidden="true">·</span>
      {followUp.status === 'created' && followUp.taskId ? (
        followUp.url ? (
          <a
            href={followUp.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t.open(followUp.taskId)}
            className="inline-flex items-center gap-1 font-mono text-text hover:text-brand-text"
          >
            {followUp.taskId}
            <ExternalLink aria-hidden="true" className="size-3" />
          </a>
        ) : (
          <span className="font-mono">{followUp.taskId}</span>
        )
      ) : followUp.status === 'failed' ? (
        <span className="text-bad">{t.failed(whyText(followUp.error))}</span>
      ) : (
        <span>{t.creating}</span>
      )}
    </p>
  );
}
