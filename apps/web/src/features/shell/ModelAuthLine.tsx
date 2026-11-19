import { copy } from '@/copy/index.ts';
import type { StatusResponse } from '@/lib/api-types.ts';

/** "Model access: Claude subscription" (P-25): the mode's name, never a value. */
export function ModelAuthLine({
  mode,
  withHint = false,
}: {
  mode: StatusResponse['modelAuth'];
  withHint?: boolean;
}) {
  const t = copy.status.modelAuth;
  return (
    <div data-testid="model-auth" data-mode={mode}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-text-2">{t.label}</span>
        <span className="font-medium">{t.modes[mode]}</span>
      </div>
      {withHint && <p className="mt-1 text-xs text-text-3">{t.hints[mode]}</p>}
    </div>
  );
}
