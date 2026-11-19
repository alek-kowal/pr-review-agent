import { useMemo, useState } from 'react';
import { copy } from '@/copy/index.ts';
import { SaveBar } from '@/features/settings/SaveBar.tsx';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsChangeRow } from '@/features/settings/use-settings-form.ts';
import type { RepositorySettings } from '@/lib/api-types.ts';
import {
  repositoryFields,
  toSettings,
  validate,
  type RepositoryForm as Form,
} from './form-model.ts';
import { RepositoryForm } from './RepositoryForm.tsx';

const t = copy.repositories;

type Props = {
  /** The form's saved state: stable while nothing was saved (e.g. memoised query data). */
  saved: Form;
  /** Saves the settings, signed; a rejected promise keeps the dialog open with its error. */
  onSave: (settings: RepositorySettings, signedBy: string) => Promise<unknown>;
  dialogTitle: string;
  /**
   * A connect: nothing is stored yet, so every field is in the save dialog (with no "Now") and
   * the save bar is always shown.
   */
  connect?: { message: string; saveLabel: string; description: string; confirmLabel: string };
};

/** A repository's form with its save bar and signed save (edit and connect). */
export function RepositoryEditor({ saved, onSave, dialogTitle, connect }: Props) {
  const fields = useMemo(() => repositoryFields({ ...t, short: t.changeTypeTable.short }), []);
  const form = useSettingsForm(saved, fields);
  const [tried, setTried] = useState(false);
  const [open, setOpen] = useState(false);
  const errors = validate(form.draft);
  const invalid = Object.keys(errors).length > 0;

  const changes: SettingsChangeRow[] = connect
    ? fields.map((field) => {
        const value = form.draft[field.key];
        return {
          key: field.key,
          label: field.label,
          before: '',
          after: field.format ? field.format(value) : String(value),
        };
      })
    : form.changes;
  // Fields that only show while ClickUp is on are left out of a connect while it is off.
  const rows =
    connect && !form.draft.clickupEnabled
      ? changes.filter((row) => !row.key.startsWith('clickup') || row.key === 'clickupEnabled')
      : changes;

  return (
    <>
      {tried && invalid && (
        <p role="alert" className="rounded-lg border border-bad/40 px-3 py-2 text-sm text-bad">
          {Object.values(errors).includes('reasonRequired')
            ? t.errors.reasonRequired
            : t.errors.summary}
        </p>
      )}
      <RepositoryForm draft={form.draft} set={form.set} errors={tried ? errors : {}} />
      <SaveBar
        count={connect ? Math.max(form.changes.length, 1) : form.changes.length}
        message={connect?.message}
        saveLabel={connect?.saveLabel}
        onDiscard={() => {
          form.discard();
          setTried(false);
        }}
        onSave={() => {
          setTried(true);
          if (!invalid) setOpen(true);
        }}
      />
      <SignedSaveDialog
        open={open}
        onOpenChange={setOpen}
        title={dialogTitle}
        description={connect?.description}
        confirmLabel={connect?.confirmLabel}
        changes={rows}
        onConfirm={(signedBy) => onSave(toSettings(form.draft), signedBy)}
      />
    </>
  );
}
