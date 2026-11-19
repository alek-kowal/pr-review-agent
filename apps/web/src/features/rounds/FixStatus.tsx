// S-07-T6: findings from an earlier commit, and what fix checks found (spec: `prototype/js/
// findings.js` `Finding` and `FindingsTab`).
import { CircleAlert, CircleCheck, CircleX, GitCommitHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge.tsx';
import { copy } from '@/copy/index.ts';
import { shortSha } from '@/copy/nextStep.ts';
import type { FindingView } from '@/lib/api-types.ts';
import type { FindingSlotProps } from '@/features/findings/slots.ts';
import { checkedFixes } from './fixes.ts';

const t = copy.findings;

/** Line slot: Resolved / Not resolved on a finding decided Implement, once a round checked it. */
export function FixBadge({ finding }: FindingSlotProps) {
  if (finding.decision?.decision !== 'implement' || !finding.fix) return null;
  const { resolved, reason } = finding.fix;
  const Icon = resolved ? CircleCheck : CircleX;
  return (
    <Badge
      variant="outline"
      data-testid="fix-badge"
      title={reason}
      className={resolved ? 'border-ok bg-ok-bg text-ok' : 'border-bad bg-bad-bg text-bad'}
    >
      <Icon aria-hidden="true" />
      {resolved ? t.fix.resolved : t.fix.notResolved}
    </Badge>
  );
}

/** Action slot: why the fix check found the finding not resolved. */
export function FixNote({ finding }: FindingSlotProps) {
  if (finding.decision?.decision !== 'implement' || finding.fix?.resolved !== false) return null;
  return (
    <p data-testid="fix-note" className="flex items-start gap-2 text-sm">
      <CircleX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-bad" />
      <span>{finding.fix.reason}</span>
    </p>
  );
}

/** The strips above the findings: "From abc1234 · 2 commits behind" and "2 of 2 fixes resolved". */
export function FindingsStrips({ findings }: { findings: readonly FindingView[] }) {
  const behind = findings.find((f) => f.commitsBehind > 0);
  const fixed = checkedFixes(findings);
  const resolved = fixed.filter((f) => f.fix!.resolved).length;
  const allResolved = resolved === fixed.length;
  const strip = 'flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm';
  return (
    <>
      {behind && (
        <div data-testid="findings-behind" className={strip} title={t.behindHint}>
          <GitCommitHorizontal aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
          <span>{t.behind(shortSha(behind.sourceSha), behind.commitsBehind)}</span>
          <span className="sr-only">{t.behindHint}</span>
        </div>
      )}
      {fixed.length > 0 && (
        <div data-testid="fixes-resolved" className={strip} title={t.fixesHint}>
          {allResolved ? (
            <CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-ok" />
          ) : (
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0 text-warn" />
          )}
          <span className="font-medium">{t.fixesResolved(resolved, fixed.length)}</span>
        </div>
      )}
    </>
  );
}
