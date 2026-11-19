import { LEVEL_NUMBERS, type LevelNumber } from '@pra/core';
import { Info, Plus, Trash2 } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { copy } from '@/copy/index.ts';
import type { FormError, PathRule, RepositoryForm as Form } from './form-model.ts';

type Props = {
  draft: Form;
  set: <K extends keyof Form>(key: K, value: Form[K]) => void;
  /** Errors to show (only after a save was tried); keys as `validate` returns them. */
  errors: Record<string, FormError>;
};

const t = copy.repositories;
/** The Select value for "no own level": the global default applies. */
const GLOBAL = 'global';

/** Every RepositoryConfig field a person sets, in sections (FR-077). */
export function RepositoryForm({ draft, set, errors }: Props) {
  const text = (key: keyof typeof t.fields & keyof Form, options: { mono?: boolean } = {}) => (
    <TextRow
      label={t.fields[key]}
      help={key in t.help ? t.help[key as keyof typeof t.help] : undefined}
      placeholder={key in t.placeholders ? t.placeholders[key as keyof typeof t.placeholders] : ''}
      value={draft[key] as string}
      onChange={(value) => set(key, value as Form[typeof key])}
      error={errors[key]}
      mono={options.mono}
    />
  );

  return (
    <div data-work-start className="flex flex-col gap-5">
      <Section title={t.sections.general}>
        <Row label={t.fields.defaultLevel} help={t.help.defaultLevel}>
          {(id) => (
            <Select
              value={draft.defaultLevel === null ? GLOBAL : String(draft.defaultLevel)}
              onValueChange={(value) =>
                set('defaultLevel', value === GLOBAL ? null : (Number(value) as LevelNumber))
              }
            >
              <SelectTrigger id={id} className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL}>{t.levelGlobal}</SelectItem>
                {LEVEL_NUMBERS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {t.level(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Row>
        {text('defaultBranch', { mono: true })}
        {text('fetchCommand', { mono: true })}
        {text('installCommand', { mono: true })}
        {text('largePrLines')}
      </Section>

      <Section title={t.sections.clickup}>
        <Row label={t.fields.clickupEnabled} help={t.help.clickupEnabled}>
          {(id) => (
            <span className="flex items-center gap-2">
              <Switch
                id={id}
                checked={draft.clickupEnabled}
                onCheckedChange={(on) => set('clickupEnabled', on)}
              />
              <span className="text-sm">{draft.clickupEnabled ? t.on : t.off}</span>
            </span>
          )}
        </Row>
        {draft.clickupEnabled && (
          <>
            {text('clickupWorkspaceId', { mono: true })}
            {text('clickupSpaceId', { mono: true })}
            {text('clickupFollowUpListId', { mono: true })}
            {text('clickupTaskIdPattern', { mono: true })}
          </>
        )}
      </Section>

      <Section
        title={t.sections.sensitive}
        hint={t.hints.sensitive}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set('sensitivePatterns', [...draft.sensitivePatterns, { pattern: '', reason: '' }])
            }
          >
            <Plus aria-hidden="true" />
            {t.sensitiveTable.add}
          </Button>
        }
      >
        {draft.sensitivePatterns.length === 0 ? (
          <p className="text-sm text-text-3">{t.sensitiveTable.empty}</p>
        ) : (
          <EditTable
            label={t.sensitiveTable.label}
            columns={[t.sensitiveTable.pattern, t.sensitiveTable.reason]}
          >
            {draft.sensitivePatterns.map((row, i) => {
              const update = (patch: Partial<typeof row>) =>
                set(
                  'sensitivePatterns',
                  draft.sensitivePatterns.map((r, j) => (j === i ? { ...r, ...patch } : r)),
                );
              return (
                <tr key={i} className="border-t border-divider align-top">
                  <td className="w-[38%] px-2 py-1.5">
                    <CellInput
                      label={t.sensitiveTable.pattern}
                      mono
                      placeholder={t.placeholders.pattern}
                      value={row.pattern}
                      onChange={(pattern) => update({ pattern })}
                      error={errors[`sensitivePatterns.${i}.pattern`]}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <CellInput
                      label={t.sensitiveTable.reason}
                      placeholder={t.placeholders.reason}
                      value={row.reason}
                      onChange={(reason) => update({ reason })}
                      error={errors[`sensitivePatterns.${i}.reason`]}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RemoveButton
                      label={t.sensitiveTable.remove(row.pattern)}
                      onClick={() =>
                        set(
                          'sensitivePatterns',
                          draft.sensitivePatterns.filter((_, j) => j !== i),
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </EditTable>
        )}
      </Section>

      <Section
        title={t.sections.changeType}
        hint={t.hints.changeType}
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set('changeTypePaths', [
                ...draft.changeTypePaths,
                { pattern: '', rule: 'usesExisting' },
              ])
            }
          >
            <Plus aria-hidden="true" />
            {t.changeTypeTable.add}
          </Button>
        }
      >
        {draft.changeTypePaths.length === 0 ? (
          <p className="text-sm text-text-3">{t.changeTypeTable.empty}</p>
        ) : (
          <EditTable
            label={t.changeTypeTable.label}
            columns={[t.changeTypeTable.pattern, t.changeTypeTable.rule]}
          >
            {draft.changeTypePaths.map((row, i) => {
              const update = (patch: Partial<typeof row>) =>
                set(
                  'changeTypePaths',
                  draft.changeTypePaths.map((r, j) => (j === i ? { ...r, ...patch } : r)),
                );
              return (
                <tr key={i} className="border-t border-divider align-top">
                  <td className="w-[38%] px-2 py-1.5">
                    <CellInput
                      label={t.changeTypeTable.pattern}
                      mono
                      placeholder={t.placeholders.pattern}
                      value={row.pattern}
                      onChange={(pattern) => update({ pattern })}
                      error={errors[`changeTypePaths.${i}.pattern`]}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <Select
                      value={row.rule}
                      onValueChange={(rule) => update({ rule: rule as PathRule })}
                    >
                      <SelectTrigger aria-label={t.changeTypeTable.rule} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(['usesExisting', 'oneWay'] as const).map((rule) => (
                          <SelectItem key={rule} value={rule}>
                            {t.changeTypeTable.rules[rule]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <RemoveButton
                      label={t.changeTypeTable.remove(row.pattern)}
                      onClick={() =>
                        set(
                          'changeTypePaths',
                          draft.changeTypePaths.filter((_, j) => j !== i),
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </EditTable>
        )}
        {text('changeTypeSizeLines')}
      </Section>
    </div>
  );
}

function Section(props: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-divider px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          {props.title}
          {props.hint && (
            <span title={props.hint} className="text-text-3">
              <Info aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{props.hint}</span>
            </span>
          )}
        </h2>
        {props.action}
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">{props.children}</div>
    </section>
  );
}

/** A label (with its help line) beside its control; stacked on narrow screens. */
function Row(props: {
  label: string;
  help?: string;
  error?: FormError;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const helpId = props.help ? `${id}-help` : undefined;
  const errorId = props.error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="grid gap-1.5 md:grid-cols-[minmax(180px,260px)_1fr] md:gap-4">
      <label htmlFor={id} className="pt-1.5 text-sm font-medium">
        {props.label}
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        {props.children(id, describedBy)}
        {props.help && (
          <p id={helpId} className="text-xs text-text-3">
            {props.help}
          </p>
        )}
        {props.error && (
          <p id={errorId} className="text-sm text-bad">
            {t.errors[props.error]}
          </p>
        )}
      </div>
    </div>
  );
}

function TextRow(props: {
  label: string;
  help?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: FormError;
  mono?: boolean;
}) {
  return (
    <Row label={props.label} help={props.help} error={props.error}>
      {(id, describedBy) => (
        <Input
          id={id}
          value={props.value}
          placeholder={props.placeholder}
          onChange={(event) => props.onChange(event.target.value)}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={describedBy}
          className={props.mono ? 'font-mono text-[13px]' : undefined}
        />
      )}
    </Row>
  );
}

function EditTable(props: { label: string; columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{props.label}</caption>
        <thead className="bg-surface-2 text-xs text-text-3">
          <tr>
            {props.columns.map((column) => (
              <th key={column} scope="col" className="px-3 py-2 font-semibold">
                {column}
              </th>
            ))}
            <th scope="col" className="w-10 px-3 py-2">
              <span className="sr-only">{t.actions}</span>
            </th>
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
    </div>
  );
}

function CellInput(props: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: FormError;
  mono?: boolean;
}) {
  const errorId = useId();
  return (
    <>
      <Input
        aria-label={props.label}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        className={props.mono ? 'font-mono text-[13px]' : undefined}
      />
      {props.error && (
        <p id={errorId} className="mt-1 text-xs text-bad">
          {t.errors[props.error]}
        </p>
      )}
    </>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
      <Trash2 aria-hidden="true" />
    </Button>
  );
}
