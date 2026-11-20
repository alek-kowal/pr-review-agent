import type { InstructionKind } from '@pra/core';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { copy } from '@/copy/index.ts';
import { FOLD_DOCUMENTS_ABOVE } from './kinds.ts';

const heading = 'px-3.5 py-1.5 text-xs font-semibold text-text-2';

/**
 * One kind's part of a list of instruction files (KINDS): "Instructions (5)" over its rows. A long
 * list of documents starts folded (native `<details>`), so the instructions stay in view.
 */
export function KindGroup({
  kind,
  count,
  children,
}: {
  kind: InstructionKind;
  count: number;
  children: ReactNode;
}) {
  const label = copy.instructions.kindCount(kind, count);
  if (kind === 'document' && count > FOLD_DOCUMENTS_ABOVE) {
    return (
      <details data-kind={kind} className="group">
        <summary className={`${heading} flex cursor-pointer list-none items-center gap-1`}>
          <ChevronRight
            aria-hidden="true"
            className="size-3.5 transition-transform group-open:rotate-90"
          />
          {label}
        </summary>
        {children}
      </details>
    );
  }
  return (
    <div data-kind={kind}>
      <h3 className={`${heading} m-0`}>{label}</h3>
      {children}
    </div>
  );
}
