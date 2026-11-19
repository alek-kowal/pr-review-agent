// S-08-T11: the Notify author card under the banner.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { NotificationView, ReviewView } from '@/lib/api-types.ts';
import { aFindingsResponse, anAuthor, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { addPendingNotify, clearPendingNotifies } from './pending.ts';

afterEach(() => {
  restoreFetch();
  clearPendingNotifies();
});

const review: ReviewView = {
  id: 7,
  signedBy: { id: 'm-tomek', name: 'Tomek' },
  worth: 2,
  notWorth: 1,
  createdAt: '2026-11-19T10:00:00.000Z',
};
const TEXT =
  '@Kasia: Tomek marked 2 findings as worth implementing and 1 finding as not worth it in PR #12';
const notification: NotificationView = {
  reviewId: 7,
  taskId: 'WB-123',
  author: 'Kasia',
  text: TEXT,
  notifiedAt: null,
};
const PREVIEW = '/api/prs/wb/12/notify-author/preview?reviewId=7';
const view = aPrView({ author: anAuthor({ login: 'kasia', name: 'Kasia' }) });

test('the card previews the exact comment; Notify author posts it once and hides the card', async () => {
  const { calls } = stubFetch({
    '/api/prs/wb/12': view,
    '/api/prs/wb/12/findings': aFindingsResponse(),
    [PREVIEW]: { notification },
    'POST /api/prs/wb/12/notify-author': {
      notification: { ...notification, notifiedAt: '2026-11-19T10:01:00.000Z' },
    },
  });
  addPendingNotify('wb', '12', review);
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const card = await screen.findByRole('region', { name: copy.notify.label });
  expect(card).toHaveTextContent("Tomek's review saved: 2 worth implementing, 1 not worth it");
  expect(await within(card).findByTestId('notify-preview')).toHaveTextContent(
    `ClickUp WB-123 · ${TEXT}`,
  );

  await user.click(within(card).getByRole('button', { name: copy.notify.notify }));
  await waitFor(() => expect(screen.queryByRole('region', { name: copy.notify.label })).toBeNull());
  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts).toHaveLength(1);
  expect((posts[0] as { body?: unknown }).body).toEqual({ reviewId: 7 });
  expect(await screen.findByText('Kasia notified in ClickUp')).toBeVisible();
});

test('without a linked task the card says so and opens the link dialog; Not now hides it', async () => {
  stubFetch({
    '/api/prs/wb/12': view,
    '/api/prs/wb/12/findings': aFindingsResponse(),
    [PREVIEW]: { status: 409, body: { error: { code: 'no_linked_task', params: {} } } },
  });
  addPendingNotify('wb', '12', review);
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const card = await screen.findByRole('region', { name: copy.notify.label });
  expect(
    await within(card).findByText('No ClickUp task linked, so there is nowhere to notify Kasia.'),
  ).toBeVisible();
  expect(within(card).queryByRole('button', { name: copy.notify.notify })).toBeNull();

  await user.click(within(card).getByRole('button', { name: copy.notify.linkTask }));
  expect(await screen.findByRole('dialog', { name: copy.clickup.linkDialog.title })).toBeVisible();
  await user.keyboard('{Escape}');

  await user.click(within(card).getByRole('button', { name: copy.notify.notNow }));
  expect(screen.queryByRole('region', { name: copy.notify.label })).toBeNull();
});
