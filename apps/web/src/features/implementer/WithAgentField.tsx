import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Label } from '@/components/ui/label.tsx';
import { copy } from '@/copy/index.ts';
import type { ReasonView } from '@/lib/api-types.ts';
import { RaiseLevelButton } from './RaiseLevelButton.tsx';

const t = copy.implementer;

/**
 * The "Implement with agent" checkbox of the Implement form and the bulk bar (S-13-T5), covered by
 * the form's signature. Off below level 4 and on forks: a disabled control takes no focus, so the
 * reason is visible text under it, tied with `aria-describedby`.
 */
export function WithAgentField({
  repo,
  number,
  block,
  checked,
  onChange,
}: {
  repo: string;
  number: string;
  block: ReasonView | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="grid gap-1" data-testid="with-agent">
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked && block === null}
          disabled={block !== null}
          aria-describedby={hintId}
          onCheckedChange={(value) => onChange(value === true)}
        />
        <Label htmlFor={id} className={block ? 'text-text-3' : undefined}>
          {t.withAgent}
        </Label>
      </div>
      <p id={hintId} className="text-xs text-text-3">
        {block ? t.blockText(block) : t.withAgentHint}
      </p>
      {block?.code === 'implement_below_level' && (
        <div>
          <RaiseLevelButton repo={repo} number={number} />
        </div>
      )}
    </div>
  );
}
