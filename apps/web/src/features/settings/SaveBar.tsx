import { useBlocker } from '@tanstack/react-router';
import { Save } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { copy } from '@/copy/index.ts';

type Props = {
  /** Unsaved changes on the page; the bar shows only when there are some. */
  count: number;
  onDiscard: () => void;
  /** Opens the page's SignedSaveDialog. */
  onSave: () => void;
  /** Replaces "N unsaved changes" (for example on a connect, where nothing is stored yet). */
  message?: string;
  /** Replaces "Save…". */
  saveLabel?: string;
};

/**
 * The sticky "N unsaved changes" bar with Discard and Save…. While the page has unsaved changes,
 * leaving it (a link, Back, or closing the tab) asks first.
 */
export function SaveBar({ count, onDiscard, onSave, message, saveLabel }: Props) {
  const blocker = useBlocker({
    shouldBlockFn: () => count > 0,
    enableBeforeUnload: () => count > 0,
    withResolver: true,
  });

  return (
    <>
      {count > 0 && (
        <div
          role="region"
          aria-label={copy.settings.saveBar.label}
          className="sticky bottom-0 z-40 -mx-4 mt-4 flex items-center justify-between gap-3 border-t border-border bg-surface px-4 py-3 shadow-[0_-4px_12px_rgba(21,21,22,0.06)] sm:mx-0 sm:rounded-lg sm:border"
        >
          <span className="text-sm font-semibold" aria-live="polite">
            {message ?? copy.settings.unsaved(count)}
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onDiscard}>
              {copy.settings.saveBar.discard}
            </Button>
            <Button type="button" onClick={onSave}>
              <Save aria-hidden="true" />
              {saveLabel ?? copy.settings.saveBar.save}
            </Button>
          </span>
        </div>
      )}
      <AlertDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.status === 'blocked') blocker.reset();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.settings.leave.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.settings.leave.description(count)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.settings.leave.stay}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (blocker.status === 'blocked') blocker.proceed();
              }}
            >
              {copy.settings.leave.leave}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
