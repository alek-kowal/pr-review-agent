import { AGENT_ROLES, validModelName, type AgentRole } from '@pra/core';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.tsx';
import { copy } from '@/copy/index.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SettingsPage } from '@/features/settings/SettingsPage.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from '@/features/settings/use-settings-form.ts';
import { ApiError } from '@/lib/api.ts';
import type { ModelsResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { modelsQuery, useModelsChange } from './queries.ts';

const t = copy.models;
type RoleModels = Record<AgentRole, string>;

/** The Select value that opens the free-text model name. */
const OTHER = '__other';

/**
 * Settings → Models (S-21-T4, FR-075): the model of each agent role. Each role picks one of the
 * defaults or types another name, checked with core's model-name rule; levels that set their own
 * model for a role are listed beside it. Saving is signed.
 */
export function ModelsPage() {
  const query = useQuery(modelsQuery());
  return (
    <SettingsPage title={t.title} affects={t.affects}>
      {query.data ? (
        <ModelsForm data={query.data} />
      ) : query.isError ? (
        <p role="alert" className="text-bad">
          {errorText(query.error instanceof ApiError ? query.error.code : 'http_error')}
        </p>
      ) : (
        <p className="text-text-3">{t.loading}</p>
      )}
    </SettingsPage>
  );
}

const FIELDS: readonly SettingsField<RoleModels>[] = AGENT_ROLES.map((role) => ({
  key: role,
  label: t.roles[role] ?? role,
}));

function ModelsForm({ data }: { data: ModelsResponse }) {
  const form = useSettingsForm<RoleModels>(data.models, FIELDS);
  const change = useModelsChange();
  const [open, setOpen] = useState(false);
  const [tried, setTried] = useState(false);
  // Roles whose model is typed rather than picked from the defaults.
  const [typed, setTyped] = useState<ReadonlySet<AgentRole>>(new Set());
  const options = useMemo(() => [...new Set(Object.values(data.defaults))], [data.defaults]);

  const invalid = AGENT_ROLES.filter((role) => !validModelName(form.draft[role].trim()));
  const showErrors = (role: AgentRole) => invalid.includes(role) && (tried || typed.has(role));

  const pick = (role: AgentRole, value: string) => {
    const next = new Set(typed);
    if (value === OTHER) next.add(role);
    else {
      next.delete(role);
      form.set(role, value);
    }
    setTyped(next);
  };

  return (
    <>
      {tried && invalid.length > 0 && (
        <p role="alert" className="rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
          {t.invalidSummary}
        </p>
      )}
      <div className="rounded-lg border border-border bg-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t.columns.role}</TableHead>
              <TableHead scope="col">{t.columns.model}</TableHead>
              <TableHead scope="col">
                <span className="inline-flex items-center gap-1.5">
                  {t.columns.overrides}
                  <span title={t.overridesHint} className="text-text-3">
                    <Info aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">{t.overridesHint}</span>
                  </span>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {AGENT_ROLES.map((role) => {
              const value = form.draft[role];
              const custom = typed.has(role) || !options.includes(value);
              const error = showErrors(role);
              const overrides = data.overrides.filter((o) => o.role === role);
              return (
                <TableRow key={role} data-role={role}>
                  <TableCell className="align-top">
                    <div className="font-medium">{t.roles[role]}</div>
                    <div className="max-w-[38ch] text-xs whitespace-normal text-text-3">
                      {t.does[role]}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-2">
                      <Select
                        value={custom ? OTHER : value}
                        onValueChange={(next) => pick(role, next)}
                      >
                        <SelectTrigger
                          aria-label={t.modelLabel(role)}
                          className="w-full font-mono text-[13px] sm:w-64"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((model) => (
                            <SelectItem key={model} value={model} className="font-mono">
                              {model === data.defaults[role] ? t.defaultOption(model) : model}
                            </SelectItem>
                          ))}
                          <SelectItem value={OTHER}>{t.other}</SelectItem>
                        </SelectContent>
                      </Select>
                      {custom && (
                        <>
                          <Input
                            aria-label={t.customLabel(role)}
                            aria-invalid={error || undefined}
                            aria-describedby={error ? `model-error-${role}` : undefined}
                            className="w-full font-mono text-[13px] sm:w-64"
                            placeholder={t.customPlaceholder}
                            value={value}
                            onChange={(event) => form.set(role, event.target.value)}
                          />
                          {error && (
                            <p id={`model-error-${role}`} className="text-xs text-bad">
                              {t.invalid}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    {overrides.length === 0 ? (
                      <span className="text-text-3">{t.noOverrides}</span>
                    ) : (
                      <ul className="grid gap-1" aria-label={t.columns.overrides}>
                        {overrides.map((o) => (
                          <li key={o.level}>
                            <Link
                              to="/settings/review-levels/$level"
                              params={{ level: String(o.level) }}
                              className="text-brand-text hover:underline"
                            >
                              {t.overrideNote(o.level, o.model)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <SaveBar
        count={form.changes.length}
        onDiscard={() => {
          form.discard();
          setTyped(new Set());
          setTried(false);
        }}
        onSave={() => {
          setTried(true);
          if (invalid.length === 0) setOpen(true);
        }}
      />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={t.saveTitle}
        description={t.saveDescription}
        changes={form.changes}
        onConfirm={(signedBy) =>
          change.mutateAsync({ before: data.models, after: trimmed(form.draft), signedBy })
        }
      />
    </>
  );
}

const trimmed = (models: RoleModels): RoleModels =>
  Object.fromEntries(AGENT_ROLES.map((role) => [role, models[role].trim()])) as RoleModels;
