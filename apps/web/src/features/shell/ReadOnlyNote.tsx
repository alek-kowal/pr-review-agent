import { Lock } from 'lucide-react';
import { copy } from '@/copy/index.ts';

const t = copy.status.githubReadOnly;

/**
 * "Read-only: GitHub App not connected" (P-28) under an action that would write to GitHub, with
 * what to do instead.
 */
export function ReadOnlyNote({ id, detail }: { id?: string; detail: string }) {
  return (
    <p id={id} className="flex items-start gap-1 text-xs text-text-3">
      <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
      <span>
        <span className="font-medium text-text-2">{t.label}.</span> {detail}
      </span>
    </p>
  );
}
