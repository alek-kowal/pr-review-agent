import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import type { DecisionView, FollowUpView } from '@/lib/api-types.ts';
import { aFinding, aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const deferred = (followUp: FollowUpView | null): DecisionView => ({
  batchId: 9,
  decision: 'defer',
  reason: 'Later',
  signedBy: { id: 'm-kasia', name: 'Kasia' },
  decidedAt: '2026-11-19T12:00:00.000Z',
  followUp,
});

const created = aFinding({
  id: 21,
  title: 'Undo loses the group',
  decision: deferred({
    status: 'created',
    taskId: '86c9abc',
    url: 'https://app.clickup.com/t/86c9abc',
    error: null,
  }),
});
const creating = aFinding({
  id: 22,
  title: 'Drag ignores the snap grid',
  decision: deferred({ status: null, taskId: null, url: null, error: null }),
});
const noList = aFinding({
  id: 23,
  title: 'Labels overflow',
  decision: deferred({
    status: 'failed',
    taskId: null,
    url: null,
    error: { code: 'follow_up_list_missing', params: {} },
  }),
});
const refused = aFinding({
  id: 24,
  title: 'Rename the helper',
  decision: deferred({
    status: 'failed',
    taskId: null,
    url: null,
    error: { code: 'clickup_auth_failed', params: {} },
  }),
});
const implemented = aFinding({
  id: 25,
  title: 'Snap lines flicker',
  decision: { ...deferred(null), decision: 'implement', reason: null },
});

afterEach(restoreFetch);

async function openFinding(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('button', { name: new RegExp(title) }));
  return screen.getByRole('article', { name: new RegExp(title) });
}

test('a deferred finding shows its follow-up task, that it is being created, or why there is none', async () => {
  stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse({
      findings: [created, creating, noList, refused, implemented],
    }),
    '/api/team': { members: [] },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12');

  const withTask = await openFinding(user, 'Undo loses the group');
  const link = within(withTask).getByRole('link', {
    name: 'Open follow-up task 86c9abc in ClickUp',
  });
  expect(link).toHaveAttribute('href', 'https://app.clickup.com/t/86c9abc');
  expect(within(withTask).getByTestId('follow-up')).toHaveTextContent(
    'Deferred to ClickUp·86c9abc',
  );

  const pending = await openFinding(user, 'Drag ignores the snap grid');
  expect(within(pending).getByTestId('follow-up')).toHaveTextContent(
    'Deferred to ClickUp·creating the ClickUp task…',
  );

  const missing = await openFinding(user, 'Labels overflow');
  expect(within(missing).getByTestId('follow-up')).toHaveTextContent(
    'no ClickUp task: no ClickUp list for follow-up tasks in the repository settings',
  );

  const failed = await openFinding(user, 'Rename the helper');
  expect(within(failed).getByTestId('follow-up')).toHaveTextContent(
    'no ClickUp task: ClickUp refused the API key.',
  );

  const other = await openFinding(user, 'Snap lines flicker');
  expect(within(other).queryByTestId('follow-up')).toBeNull();
});
