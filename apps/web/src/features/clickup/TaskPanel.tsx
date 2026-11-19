import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
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
import { copy } from '@/copy/index.ts';
import { prKeys, prPath } from '@/features/pr/queries.ts';
import type { PrSlotProps } from '@/features/pr/slots.ts';
import { ApiError, apiRequest } from '@/lib/api.ts';
import type { TaskSectionView } from '@/lib/api-types.ts';
import { errorText } from '@/lib/reasons.ts';

/**
 * The PR's ClickUp task in the PR page's side column (S-06-T4): the linked task (name and ID,
 * opening ClickUp), "No ClickUp task linked" with "Link a ClickUp task", or that the repository
 * has no ClickUp.
 */
export function TaskPanel({ view, repo, number }: PrSlotProps) {
  const t = copy.clickup;
  const { configured, link } = view.task;
  const [open, setOpen] = useState(false);

  return (
    <section
      aria-labelledby="task-panel-title"
      data-testid="task-panel"
      className="rounded-lg border border-border bg-surface px-3.5 py-3 text-[13px]"
    >
      <h2 id="task-panel-title" className="m-0 mb-1.5 text-xs font-semibold text-text-3">
        {t.panel.title}
      </h2>
      {!configured ? (
        <p className="m-0 text-text-3">{t.noTask.clickup_not_configured}</p>
      ) : link ? (
        <div className="flex flex-col gap-1">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t.panel.open(link.taskId)}
            className="inline-flex items-start gap-1 font-medium text-text hover:text-brand-text"
          >
            <span>{link.name}</span>
            <ExternalLink aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          </a>
          <span className="text-xs text-text-3">
            <span className="font-mono">{link.taskId}</span> · {t.how[link.how] ?? link.how}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="self-start border-0 bg-transparent p-0 text-xs text-brand-text"
          >
            {t.panel.changeButton}
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-2">
          <p className="m-0 text-text-2">{t.noTask.no_task_linked}</p>
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t.panel.linkButton}
          </Button>
        </div>
      )}
      {configured && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent closeLabel={t.linkDialog.cancel}>
            {open && <LinkTaskForm repo={repo} number={number} onDone={() => setOpen(false)} />}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

function LinkTaskForm({
  repo,
  number,
  onDone,
}: {
  repo: string;
  number: string;
  onDone: () => void;
}) {
  const t = copy.clickup.linkDialog;
  const id = useId();
  const [value, setValue] = useState('');
  const queryClient = useQueryClient();
  const link = useMutation({
    mutationFn: (taskIdOrUrl: string) =>
      apiRequest<{ task: TaskSectionView }>(`${prPath(repo, number)}/task-link`, {
        method: 'PUT',
        body: { taskIdOrUrl },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: prKeys.view(repo, number), exact: true }),
        queryClient.invalidateQueries({ queryKey: prKeys.timeline(repo, number) }),
      ]);
      onDone();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) link.mutate(value.trim());
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t.title}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={id}>{t.field}</Label>
        <Input
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t.placeholder}
          autoComplete="off"
          autoFocus
        />
      </div>
      {link.isError && (
        <p role="alert" className="text-sm text-bad">
          {errorText(link.error instanceof ApiError ? link.error.code : 'http_error')}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t.cancel}
        </Button>
        <Button type="submit" disabled={link.isPending || !value.trim()}>
          {link.isPending ? t.saving : t.confirm}
        </Button>
      </DialogFooter>
    </form>
  );
}
