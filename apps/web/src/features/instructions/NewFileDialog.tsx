import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import type { InstructionsListResponse } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';
import { useCreateInstructionFile } from './queries.ts';

const t = copy.instructions.newFile;
/** The scope Select's value for Global (a slug never starts with `@`). */
const GLOBAL = '@global';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repositories: InstructionsListResponse['repositories'];
};

/** New file (STAGEFILES): key, kind, scope, first version and note; opens the editor on its draft. */
export function NewFileDialog({ open, onOpenChange, repositories }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.close} className="sm:max-w-xl">
        {/* Mounted per open, so each opening starts empty. */}
        <NewFileForm repositories={repositories} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewFileForm({
  repositories,
  onCancel,
}: Pick<Props, 'repositories'> & { onCancel: () => void }) {
  const navigate = useNavigate();
  const create = useCreateInstructionFile();
  const [fileKey, setFileKey] = useState('');
  const [kind, setKind] = useState<'instruction' | 'document'>('instruction');
  const [scope, setScope] = useState(GLOBAL);
  const [content, setContent] = useState('');
  const [note, setNote] = useState('');
  const ids = { key: useId(), kind: useId(), scope: useId(), content: useId(), note: useId() };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      const detail = await create.mutateAsync({
        fileKey: fileKey.trim(),
        kind,
        ...(scope === GLOBAL
          ? { scope: 'global' as const }
          : { scope: 'repository' as const, repository: scope }),
        content,
        note: note.trim() || null,
      });
      await navigate({ to: '/settings/instructions/$id', params: { id: String(detail.file.id) } });
    } catch {
      // `create.error` shows it above the buttons.
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.key}>{t.key}</Label>
        <Input
          id={ids.key}
          value={fileKey}
          required
          className="font-mono text-[13px]"
          aria-describedby={`${ids.key}-hint`}
          onChange={(event) => setFileKey(event.target.value)}
        />
        <p id={`${ids.key}-hint`} className="text-xs text-text-3">
          {t.keyHint}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label id={ids.kind}>{t.kind}</Label>
          <Select value={kind} onValueChange={(next) => setKind(next as typeof kind)}>
            <SelectTrigger aria-labelledby={ids.kind}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="instruction">{t.kinds.instruction}</SelectItem>
              <SelectItem value="document">{t.kinds.document}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label id={ids.scope}>{t.scope}</Label>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger aria-labelledby={ids.scope}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL}>{t.global}</SelectItem>
              {repositories.map((r) => (
                <SelectItem key={r.id} value={r.slug}>
                  {r.slug}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.content}>{t.content}</Label>
        <Textarea
          id={ids.content}
          value={content}
          spellCheck={false}
          className="min-h-40 font-mono text-[13px]"
          onChange={(event) => setContent(event.target.value)}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={ids.note}>{t.note}</Label>
        <Input id={ids.note} value={note} onChange={(event) => setNote(event.target.value)} />
      </div>
      {create.isError && (
        <p role="alert" className="text-sm text-bad">
          {errorText(create.error instanceof ApiError ? create.error.code : 'http_error')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" disabled={create.isPending || fileKey.trim() === ''}>
          {create.isPending ? t.creating : t.create}
        </Button>
      </DialogFooter>
    </form>
  );
}
