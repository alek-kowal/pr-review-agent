import { BUILT_IN_FILE } from '@pra/core';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { copy } from '@/copy/index.ts';
import { SignedSaveDialog } from '@/features/settings/SignedSaveDialog.tsx';
import type {
  FileOption,
  PipelineResponse,
  PipelineStageKey,
  StageFileChoice,
  StageFilesView,
  StageSlotName,
  StageSlotView,
} from '@/lib/api-types.ts';
import { useStageFilesSave } from './queries.ts';

const t = copy.pipeline;
const f = t.files;

/** A slot's pending change: the keys to store, or null to go back to inheriting. */
type Edits = Partial<Record<StageSlotName, string[] | null>>;

type Props = {
  stageKey: PipelineStageKey;
  stageLabel: string;
  files: StageFilesView;
  options: PipelineResponse['options'];
  /** The repository's slug at repository scope; null at Global scope. */
  repository: string | null;
};

const sameKeys = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * A stage's instruction files at one scope (STAGEFILES): a Select per prompt and rules slot, a
 * checkbox list of documents, the version each key resolves to, where the value comes from and
 * Reset. Save asks for a signature and sends the stored choice at this scope as `before`.
 */
export function StageFilesForm({ stageKey, stageLabel, files, options, repository }: Props) {
  const [edits, setEdits] = useState<Edits>({});
  const [signing, setSigning] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = useStageFilesSave();
  const stored = (repository ? files.choice.repository : files.choice.global) ?? null;
  const changed = Object.keys(edits) as StageSlotName[];

  const setSlot = (slot: StageSlotView, keys: string[] | null) => {
    setSaved(false);
    setEdits((prev) => {
      const next = { ...prev };
      // Picking the value the slot already reads is no change.
      if (keys !== null && sameKeys(keys, slot.value)) delete next[slot.name];
      else next[slot.name] = keys;
      return next;
    });
  };
  const undo = (slot: StageSlotView) =>
    setEdits((prev) => {
      const next = { ...prev };
      delete next[slot.name];
      return next;
    });

  const after = (): StageFileChoice | null => {
    const out: StageFileChoice = { ...stored };
    for (const name of changed) {
      const keys = edits[name];
      if (keys === null || keys === undefined) delete out[name];
      else if (name === 'documents') out.documents = keys;
      else out[name] = keys[0] ?? null;
    }
    return Object.values(out).some((v) => v != null) ? out : null;
  };

  const display = (keys: readonly string[] | null | undefined) =>
    keys == null
      ? repository
        ? f.inheritsGlobal
        : f.inheritsDefault
      : keys.length === 0
        ? f.none
        : keys.map((k) => (k === BUILT_IN_FILE ? f.builtIn : k)).join(', ');

  return (
    <section aria-labelledby={`files-${stageKey}`} className="flex flex-col gap-3">
      <div>
        <h3 id={`files-${stageKey}`} className="font-semibold">
          {f.title}
        </h3>
        <p className="text-xs text-text-3">
          {repository ? f.scopeRepository(repository) : f.scopeGlobal}
        </p>
      </div>
      {files.slots.map((slot) => (
        <SlotField
          key={slot.name}
          stageLabel={stageLabel}
          slot={slot}
          edit={edits[slot.name]}
          edited={slot.name in edits}
          options={options[slot.kind]}
          repository={repository}
          onPick={(keys) => setSlot(slot, keys)}
          onReset={() => (ownsSlot(slot, repository) ? setSlot(slot, null) : undo(slot))}
        />
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={changed.length === 0} onClick={() => setSigning(true)}>
          {f.save}
        </Button>
        {saved && (
          <p role="status" className="text-sm text-text-2">
            {f.saved}
          </p>
        )}
      </div>
      <SignedSaveDialog
        open={signing}
        onOpenChange={setSigning}
        title={f.dialogTitle(stageLabel)}
        description={f.dialogDescription(
          repository ? f.scopeRepository(repository) : f.scopeGlobal,
        )}
        changes={changed.map((name) => ({
          key: name,
          label: f.slots[name] ?? name,
          before: display(files.slots.find((s) => s.name === name)?.value),
          after: display(edits[name]),
        }))}
        onConfirm={async (signedBy) => {
          await save.mutateAsync({
            stage: stageKey,
            body: { repository, before: stored, after: after(), signedBy },
          });
          setEdits({});
          setSaved(true);
        }}
      />
    </section>
  );
}

/** Whether the slot's value is stored at this scope (so Reset removes it). */
const ownsSlot = (slot: StageSlotView, repository: string | null) =>
  slot.source === (repository ? 'repository' : 'global');

function SlotField({
  stageLabel,
  slot,
  edit,
  edited,
  options,
  repository,
  onPick,
  onReset,
}: {
  stageLabel: string;
  slot: StageSlotView;
  edit: string[] | null | undefined;
  edited: boolean;
  options: readonly FileOption[];
  repository: string | null;
  onPick: (keys: string[]) => void;
  onReset: () => void;
}) {
  const id = useId();
  const name = f.slots[slot.name] ?? slot.name;
  const resetPending = edited && edit === null;
  const value = resetPending ? [] : edited ? (edit ?? []) : slot.value;
  const own = ownsSlot(slot, repository);
  const sourceText = resetPending
    ? repository
      ? f.source.resetRepository
      : f.source.resetGlobal
    : own || edited
      ? repository
        ? f.source.overridden
        : f.source.changed
      : repository
        ? f.source.inherited
        : f.source.default;
  const canReset = (own && !resetPending) || (!own && edited);
  // The keys a slot can pick, with any key it reads that the scope no longer has.
  const optionOf = (key: string): FileOption =>
    options.find((o) => o.fileKey === key) ??
    slot.files.find((o) => o.fileKey === key) ?? {
      fileKey: key,
      kind: slot.kind,
      fileId: null,
      version: null,
      scope: null,
    };
  const keys = [
    ...options.map((o) => o.fileKey),
    ...value.filter((k) => k !== BUILT_IN_FILE && !options.some((o) => o.fileKey === k)),
  ];

  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={id} className="text-text-3">
          {name}
        </span>
        <span className="flex items-center gap-2 text-xs text-text-3">
          <span>{sourceText}</span>
          {canReset && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={f.reset(name)}
              onClick={onReset}
            >
              {f.resetLabel}
            </Button>
          )}
        </span>
      </div>
      {slot.name === 'documents' ? (
        keys.length === 0 ? (
          <p className="text-text-3">{f.noDocuments}</p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
            {keys.map((key) => {
              const option = optionOf(key);
              const checked = value.includes(key);
              return (
                <li key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-${key}`}
                    checked={checked}
                    disabled={resetPending}
                    onCheckedChange={(on) =>
                      onPick(on ? [...value, key] : value.filter((k) => k !== key))
                    }
                  />
                  <label htmlFor={`${id}-${key}`} className="font-mono text-[13px]">
                    {key}
                  </label>
                  <FileLink option={option} versionOnly />
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <>
          <Select
            value={value[0] ?? ''}
            disabled={resetPending}
            onValueChange={(next) => onPick([next])}
          >
            <SelectTrigger
              aria-label={f.pick(stageLabel, name)}
              className="w-full font-mono text-[13px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {slot.builtIn && <SelectItem value={BUILT_IN_FILE}>{f.builtIn}</SelectItem>}
              {keys.map((key) => (
                <SelectItem key={key} value={key} className="font-mono">
                  {key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value
            .filter((k) => k !== BUILT_IN_FILE)
            .map((key) => (
              <FileLink key={key} option={optionOf(key)} />
            ))}
        </>
      )}
    </div>
  );
}

/** `fileKey vN` linking to the file the scope reads, or "(no active version)". */
function FileLink({ option, versionOnly = false }: { option: FileOption; versionOnly?: boolean }) {
  const text = versionOnly
    ? t.sheet.version(option.version)
    : t.sheet.fileVersion(option.fileKey, option.version);
  return (
    <span className="text-[13px]">
      {option.fileId !== null ? (
        <Link
          to="/settings/instructions/$id"
          params={{ id: String(option.fileId) }}
          aria-label={versionOnly ? t.sheet.fileVersion(option.fileKey, option.version) : undefined}
          className="font-mono text-brand-text hover:underline"
        >
          {text}
        </Link>
      ) : (
        <span className="font-mono text-text-3">{text}</span>
      )}
      {option.copies && option.copies.length > 0 && (
        <span className="ml-2 text-xs text-text-3">{f.onlyIn(option.copies)}</span>
      )}
    </span>
  );
}
