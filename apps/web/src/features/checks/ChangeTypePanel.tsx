import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { copy } from '@/copy/index.ts';
import { prKeys, prPath } from '@/features/pr/queries.ts';
import type { PrSlotProps } from '@/features/pr/slots.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import type { ChangeType, ChecksSectionView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';

const AUTOMATIC = 'automatic';

/**
 * The PR's change type in the PR page's side column (S-04-T6): plain grey text with how it was set,
 * the type forced for the next round, Force type (unsigned, FR-030), and for a PR over the
 * repository's large-PR threshold a warning that suggests splitting it.
 */
export function ChangeTypePanel({ view, repo, number }: PrSlotProps) {
  const t = copy.checks;
  const { changeType, forced, largePr } = view.checks;
  const forcedApplied =
    changeType?.reason.code === 'forced_by_person' && changeType.value === forced;

  return (
    <section
      aria-labelledby="change-type-panel-title"
      data-testid="change-type-panel"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-3.5 py-3 text-[13px]"
    >
      <h2 id="change-type-panel-title" className="m-0 text-xs font-semibold text-text-3">
        {t.panel.title}
      </h2>
      <p className="m-0 text-text-3" data-testid="change-type">
        {changeType
          ? `${t.changeType(changeType.value)} · ${t.how(changeType.reason.code)}`
          : t.panel.none}
      </p>
      {forced && !forcedApplied && (
        <p className="m-0 text-xs text-text-3" data-testid="change-type-forced">
          {t.panel.forcedNext(forced)}
        </p>
      )}
      {largePr && (
        <div
          role="note"
          data-testid="large-pr-warning"
          className="flex gap-1.5 rounded-md border border-warn-line bg-warn-bg px-2.5 py-2 text-xs text-warn"
        >
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <p className="m-0">
            <span className="font-semibold">{t.largePr.title}.</span>{' '}
            {t.largePr.text(largePr.lines, largePr.threshold)}
          </p>
        </div>
      )}
      {view.pullRequest.state === 'open' && (
        <ForceType repo={repo} number={number} forced={forced} />
      )}
    </section>
  );
}

function ForceType({
  repo,
  number,
  forced,
}: {
  repo: string;
  number: string;
  forced: ChangeType | null;
}) {
  const t = copy.checks.panel;
  const selectId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(forced ?? AUTOMATIC);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (changeType: ChangeType | null) =>
      apiRequest<{ checks: ChecksSectionView }>(`${prPath(repo, number)}/change-type`, {
        method: 'PUT',
        body: { changeType },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number), exact: true }),
        queryClient.invalidateQueries({ queryKey: prKeys.timeline(repo, number) }),
      ]);
      setOpen(false);
    },
  });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(forced ?? AUTOMATIC);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="self-start">
          {t.force}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-[280px] gap-2.5 p-3">
        <p className="m-0 text-sm font-semibold">{t.forceTitle}</p>
        <p className="m-0 text-xs text-text-3">{t.forceHint}</p>
        <div className="grid gap-1">
          <Label htmlFor={selectId}>{t.forceLabel}</Label>
          <Select value={value} onValueChange={setValue}>
            <SelectTrigger id={selectId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTOMATIC}>{t.automatic}</SelectItem>
              {Object.entries(copy.checks.changeTypes).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {save.isError && (
          <p role="alert" className="m-0 text-sm text-bad">
            {errorText(save.error instanceof ApiError ? save.error.code : 'http_error')}
          </p>
        )}
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate(value === AUTOMATIC ? null : (value as ChangeType))}
        >
          {t.save}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
