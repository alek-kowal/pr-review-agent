import { LEVEL_NUMBERS, type LevelNumber } from '@pra/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Info } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { copy } from '@/copy/index.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { ApiError } from '@/lib/api.ts';
import type { LevelsResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { levelsQuery, useDefaultLevelChange } from './queries.ts';

const t = copy.levels;

/**
 * Settings → Review levels (S-21-T5, FR-078): the 1–6 ladder with what each level adds, and the
 * default level for repositories without their own (signed).
 */
export function ReviewLevelsPage() {
  const query = useQuery(levelsQuery());
  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {query.data ? (
        <>
          <Ladder defaultLevel={query.data.defaultLevel} />
          <DefaultLevel data={query.data} />
        </>
      ) : query.isError ? (
        <p role="alert" data-work-start className="text-bad">
          {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
        </p>
      ) : (
        <p className="text-text-3">{t.loading}</p>
      )}
    </SettingsPage>
  );
}

function Ladder({ defaultLevel }: { defaultLevel: LevelNumber }) {
  return (
    <Section title={t.ladder.title} sub={t.ladder.sub} workStart>
      <ol aria-label={t.ladder.label} className="divide-y divide-divider">
        {LEVEL_NUMBERS.map((n) => (
          <li key={n}>
            <Link
              to="/settings/review-levels/$level"
              params={{ level: String(n) }}
              data-level={n}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-sm font-semibold',
                  n <= defaultLevel
                    ? 'border-brand-text bg-brand-text text-surface'
                    : 'border-border text-text-2',
                )}
              >
                {n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{t.page.title(n)}</span>
                {n === defaultLevel && (
                  <span className="ml-2 rounded-full border border-brand-text/40 px-2 py-0.5 text-xs font-medium text-brand-text">
                    {t.defaultBadge}
                  </span>
                )}
                <span className="mt-0.5 block text-sm text-text-2">{t.description[n]}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 text-text-3" />
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}

type DefaultForm = { defaultLevel: LevelNumber };
const DEFAULT_FIELDS: readonly SettingsField<DefaultForm>[] = [
  {
    key: 'defaultLevel',
    label: t.defaultLevel.field,
    format: (n) => t.levelOption(n as number),
  },
];

function DefaultLevel({ data }: { data: LevelsResponse }) {
  const saved = useMemo(() => ({ defaultLevel: data.defaultLevel }), [data.defaultLevel]);
  const form = useSettingsForm(saved, DEFAULT_FIELDS);
  const change = useDefaultLevelChange();
  const [open, setOpen] = useState(false);
  const d = t.defaultLevel;
  return (
    <Section title={d.title}>
      <div className="grid gap-1.5 px-4 py-4 text-sm md:grid-cols-[minmax(180px,260px)_1fr] md:gap-4">
        <span className="flex items-start gap-1.5 font-medium">
          <label htmlFor="default-level">{d.label}</label>
          <span title={d.hint} className="mt-0.5 text-text-3">
            <Info aria-hidden="true" className="size-3.5" />
            <span className="sr-only">{d.hint}</span>
          </span>
        </span>
        <Select
          value={String(form.draft.defaultLevel)}
          onValueChange={(value) => form.set('defaultLevel', Number(value) as LevelNumber)}
        >
          <SelectTrigger id="default-level" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVEL_NUMBERS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {t.levelOption(n)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <SaveBar count={form.changes.length} onDiscard={form.discard} onSave={() => setOpen(true)} />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={d.saveTitle}
        description={d.saveDescription(form.draft.defaultLevel)}
        changes={form.changes}
        onConfirm={(signedBy) =>
          change.mutateAsync({
            before: data.defaultLevel,
            after: form.draft.defaultLevel,
            signedBy,
          })
        }
      />
    </Section>
  );
}

export function Section(props: {
  title: string;
  sub?: string;
  actions?: ReactNode;
  /** The screen's work start (S-17-T9 layout check): the first section a page shows. */
  workStart?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={props.title}
      data-work-start={props.workStart ? '' : undefined}
      className="rounded-lg border border-border bg-surface"
    >
      <header className="flex items-start justify-between gap-3 border-b border-divider px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold">{props.title}</h2>
          {props.sub && <p className="mt-0.5 text-xs text-text-3">{props.sub}</p>}
        </div>
        {props.actions}
      </header>
      {props.children}
    </section>
  );
}
