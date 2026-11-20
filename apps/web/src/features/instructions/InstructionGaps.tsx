import { TriangleAlert } from 'lucide-react';
import { copy } from '@/copy/index.ts';
import type { InstructionsListResponse } from '@/lib/api-types.ts';
import { groupGaps } from './gaps.ts';

const t = copy.instructions;

/** Settings → Instructions (INSTR): per repository, the required files its rounds would miss. */
export function InstructionGaps({ gaps }: { gaps: InstructionsListResponse['gaps'] }) {
  if (gaps.length === 0) return null;
  return (
    <section
      aria-label={t.gaps.title}
      data-testid="instruction-gaps"
      className="flex gap-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-sm text-warn"
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1.5">
        <h2 className="font-semibold">{t.gaps.title}</h2>
        <p className="text-xs">{t.gaps.hint}</p>
        {gaps.map(({ repository, gaps: repositoryGaps }) => (
          <div key={repository.id}>
            <h3 className="font-medium">{t.groups.repository(repository.slug)}</h3>
            <ul className="list-disc pl-5">
              {groupGaps(repositoryGaps).map((line) => (
                <li key={`${line.stage}:${line.missing.join(',')}`}>
                  {t.gaps.line(line.levels, line.stage, line.missing)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
