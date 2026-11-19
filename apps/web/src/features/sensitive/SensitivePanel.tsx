import { ShieldAlert } from 'lucide-react';
import { useId } from 'react';
import { copy } from '@/copy/index.ts';
import type { PrSlotProps } from '@/features/pr/slots.ts';

const t = copy.sensitive;

/**
 * The PR's sensitive files in the side column (spec: `prototype/js/pr.js` "Sensitive files"):
 * each path with the pattern it matched and the repository's reason, and the send back comment.
 */
export function SensitivePanel({ view }: PrSlotProps) {
  const titleId = useId();
  const { status, files, sentBack } = view.sensitive;
  return (
    <section
      aria-labelledby={titleId}
      data-testid="sensitive-files"
      className="rounded-lg border border-border bg-surface"
    >
      <div className="flex items-center justify-between gap-2 border-b border-divider px-3.5 py-2.5">
        <h2
          id={titleId}
          className="flex items-center gap-1.5 font-heading text-[13px] font-semibold"
        >
          <ShieldAlert aria-hidden="true" className="size-[14px] text-warn" />
          {t.title}
        </h2>
        {status && (
          <span data-testid="sensitive-status" className="text-xs text-text-3">
            {t.status[status]}
          </span>
        )}
      </div>
      <ul className="divide-y divide-divider">
        {files.map((file) => (
          <li key={file.path} className="px-3.5 py-2 text-[13px]">
            <div className="font-mono break-all">{file.path}</div>
            <div className="mt-0.5 text-xs text-text-3">{t.rule(file.pattern, file.reason)}</div>
          </li>
        ))}
      </ul>
      {status === 'sent_back' && sentBack && (
        <p className="border-t border-divider px-3.5 py-2 text-xs text-text-2">
          {t.comment(sentBack.comment)}
        </p>
      )}
    </section>
  );
}

/** The banner's second line while sensitive files wait: why, or the send back comment. */
export function SensitiveBannerLine({ view }: PrSlotProps) {
  if (view.nextStep.state !== 'sensitive_files') return null;
  const { sentBack, status } = view.sensitive;
  return (
    <p data-testid="sensitive-line" className="text-[13px] text-text-2">
      {status === 'sent_back' && sentBack ? t.comment(sentBack.comment) : t.pendingLine}
    </p>
  );
}
