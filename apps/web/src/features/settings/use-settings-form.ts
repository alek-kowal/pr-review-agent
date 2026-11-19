import { useState } from 'react';

/** One field of a Settings form: its label in the save dialog and how its value reads there. */
export type SettingsField<T> = {
  key: keyof T & string;
  label: string;
  format?: (value: T[keyof T]) => string;
};

/** One row of the save dialog's before/after table. */
export type SettingsChangeRow = { key: string; label: string; before: string; after: string };

/**
 * A Settings page's draft over its saved values. `changes` lists the fields that differ, for the
 * SaveBar count and the save dialog. When `saved` changes (after a save or a refetch) the draft
 * starts over from it, so pass a stable object (for example query data).
 */
export function useSettingsForm<T extends Record<string, unknown>>(
  saved: T,
  fields: readonly SettingsField<T>[],
) {
  const [base, setBase] = useState(saved);
  const [draft, setDraft] = useState(saved);
  if (base !== saved) {
    setBase(saved);
    setDraft(saved);
  }

  const changes: SettingsChangeRow[] = fields
    .filter((field) => !sameValue(base[field.key], draft[field.key]))
    .map((field) => {
      const show = (value: T[keyof T]) => (field.format ? field.format(value) : String(value));
      return {
        key: field.key,
        label: field.label,
        before: show(base[field.key]),
        after: show(draft[field.key]),
      };
    });

  return {
    draft,
    set: <K extends keyof T>(key: K, value: T[K]) =>
      setDraft((current) => ({ ...current, [key]: value })),
    discard: () => setDraft(base),
    changes,
    dirty: changes.length > 0,
  };
}

const sameValue = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
