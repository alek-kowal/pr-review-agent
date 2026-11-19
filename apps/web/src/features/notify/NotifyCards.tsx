// S-08-T11 (FR-039, OQ12): after a signed review, a card under the banner previews the exact
// ClickUp comment with Notify author and Not now. Without a linked task it says so and offers
// "Link a ClickUp task" (the S-06 link dialog). Spec: `prototype/js/pr.js` `NotifyCards`.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent } from '@/components/ui/dialog.tsx';
import { copy } from '@/copy/index.ts';
import { LinkTaskForm } from '@/features/clickup/TaskPanel.tsx';
import { prKeys, prPath } from '@/features/pr/queries.ts';
import type { PrSlotProps } from '@/features/pr/slots.ts';
import { ApiError, apiGet, apiRequest } from '@/lib/api.ts';
import type { NotificationResponse, PrView, ReviewView } from '@/lib/api-types.ts';
import { authorName } from '@/lib/next-step.ts';
import { errorText } from '@/lib/reasons.ts';
import { dismissPendingNotify, usePendingNotifies } from './pending.ts';

const t = copy.notify;

export function NotifyCards({ repo, number, view }: PrSlotProps) {
  const reviews = usePendingNotifies(repo, number);
  if (reviews.length === 0) return null;
  return (
    <div className="mt-3 grid gap-3">
      {reviews.map((review) => (
        <NotifyCard key={review.id} repo={repo} number={number} view={view} review={review} />
      ))}
    </div>
  );
}

function NotifyCard({
  repo,
  number,
  view,
  review,
}: {
  repo: string;
  number: string;
  view: PrView;
  review: ReviewView;
}) {
  const queryClient = useQueryClient();
  const [linking, setLinking] = useState(false);
  const linkedTask = view.task.link?.taskId ?? null;
  // Keyed by the linked task, so linking one shows the comment at once.
  const preview = useQuery({
    queryKey: [...prKeys.view(repo, number), 'notify-author', review.id, linkedTask],
    queryFn: ({ signal }) =>
      apiGet<NotificationResponse>(
        `${prPath(repo, number)}/notify-author/preview?reviewId=${review.id}`,
        signal,
      ),
    retry: false,
  });
  const dismiss = () => dismissPendingNotify(repo, number, review.id);
  const post = useMutation({
    mutationFn: () =>
      apiRequest<NotificationResponse>(`${prPath(repo, number)}/notify-author`, {
        method: 'POST',
        body: { reviewId: review.id },
      }),
    onSuccess: ({ notification }) => {
      toast.success(t.toast.notified(notification.author), {
        description: t.toast.notifiedHint(notification.taskId),
      });
      dismiss();
      void queryClient.invalidateQueries({ queryKey: prKeys.timeline(repo, number) });
    },
  });

  const notification = preview.data?.notification;
  // Someone posted it already (another tab): nothing left to offer.
  const posted = Boolean(notification?.notifiedAt);
  useEffect(() => {
    if (posted) dismissPendingNotify(repo, number, review.id);
  }, [posted, repo, number, review.id]);
  if (posted) return null;
  const failure = preview.error instanceof ApiError ? preview.error.code : null;
  const noTask = failure === 'no_linked_task';
  const failed = post.error
    ? errorText(post.error instanceof ApiError ? post.error.code : 'http_error')
    : null;

  return (
    <section
      aria-label={t.label}
      data-testid="notify-card"
      className="flex flex-wrap items-start gap-3 rounded-lg border border-border bg-surface p-3"
    >
      <div className="min-w-[240px] flex-1">
        <p className="m-0 font-medium">
          {t.title(review.signedBy.name, review.worth, review.notWorth)}
        </p>
        {notification ? (
          <p
            data-testid="notify-preview"
            className="m-0 mt-1.5 rounded-md border border-divider bg-inset px-3 py-2 text-sm"
          >
            <span className="text-xs text-text-3">{t.previewSource(notification.taskId)} · </span>
            {notification.text}
          </p>
        ) : (
          <p className="m-0 mt-0.5 text-sm text-text-3">
            {preview.isPending
              ? t.loading
              : noTask
                ? t.noTask(authorName(view.author))
                : errorText(failure ?? 'http_error')}
          </p>
        )}
        {failed && (
          <p role="alert" className="m-0 mt-1.5 text-sm text-bad">
            {failed}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={dismiss}>
          {t.notNow}
        </Button>
        {notification && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={post.isPending}
            onClick={() => post.mutate()}
          >
            <Send aria-hidden="true" />
            {post.isPending ? t.notifying : t.notify}
          </Button>
        )}
        {noTask && view.task.configured && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setLinking(true)}>
            <Link2 aria-hidden="true" />
            {t.linkTask}
          </Button>
        )}
      </div>
      {noTask && view.task.configured && (
        <Dialog open={linking} onOpenChange={setLinking}>
          <DialogContent closeLabel={copy.clickup.linkDialog.cancel}>
            {linking && (
              <LinkTaskForm repo={repo} number={number} onDone={() => setLinking(false)} />
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
