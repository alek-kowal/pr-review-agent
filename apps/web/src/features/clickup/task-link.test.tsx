import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { TaskSectionView } from '@/lib/api-types.ts';
import { aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const LINKED: TaskSectionView = {
  configured: true,
  link: {
    taskId: 'WB-12',
    name: 'Rename edge labels inline',
    url: 'https://app.clickup.com/t/86c1abc',
    how: 'branch',
    linkedBy: 'bot',
  },
};

const openPr = (task: TaskSectionView, extra: Record<string, unknown> = {}) => {
  const stub = stubFetch({
    '/api/prs/wb/12': aPrView({ task }),
    '/api/prs/wb/12/findings': aFindingsResponse(),
    ...extra,
  });
  renderApp('/pr/wb/12');
  return stub;
};

const panel = () => screen.findByRole('region', { name: copy.clickup.panel.title });

describe('ClickUp task panel', () => {
  it('shows the linked task with its ID, opening ClickUp', async () => {
    openPr(LINKED);

    const region = await panel();
    const link = within(region).getByRole('link', { name: copy.clickup.panel.open('WB-12') });
    expect(link).toHaveAttribute('href', 'https://app.clickup.com/t/86c1abc');
    expect(link).toHaveTextContent('Rename edge labels inline');
    expect(region).toHaveTextContent('WB-12');
    expect(region).toHaveTextContent(copy.clickup.how.branch!);
  });

  it('says no task is linked and offers to link one', async () => {
    openPr({ configured: true, link: null });

    const region = await panel();
    expect(region).toHaveTextContent(copy.clickup.noTask.no_task_linked!);
    expect(
      within(region).getByRole('button', { name: copy.clickup.panel.linkButton }),
    ).toBeVisible();
  });

  it('says when the repository has no ClickUp, with nothing to link', async () => {
    openPr({ configured: false, link: null });

    const region = await panel();
    expect(region).toHaveTextContent(copy.clickup.noTask.clickup_not_configured!);
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('the dialog submits the task ID or link and closes', async () => {
    const { calls } = openPr(
      { configured: true, link: null },
      {
        'PUT /api/prs/wb/12/task-link': {
          task: { ...LINKED, link: { ...LINKED.link!, how: 'hand' } },
        },
      },
    );
    const user = userEvent.setup();

    await user.click(
      within(await panel()).getByRole('button', { name: copy.clickup.panel.linkButton }),
    );
    const dialog = await screen.findByRole('dialog', { name: copy.clickup.linkDialog.title });
    await user.type(
      within(dialog).getByLabelText(copy.clickup.linkDialog.field),
      'https://app.clickup.com/t/86c1abc',
    );
    await user.click(within(dialog).getByRole('button', { name: copy.clickup.linkDialog.confirm }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const put = calls.find((call) => call.method === 'PUT');
    expect(put).toMatchObject({
      path: '/api/prs/wb/12/task-link',
      headers: { 'X-PRA-Request': '1' },
      body: { taskIdOrUrl: 'https://app.clickup.com/t/86c1abc' },
    });
  });

  it('an unknown task keeps the dialog open with the reason', async () => {
    openPr(
      { configured: true, link: null },
      {
        'PUT /api/prs/wb/12/task-link': {
          status: 422,
          body: { error: { code: 'task_not_found', params: { taskId: 'WB-999' } } },
        },
      },
    );
    const user = userEvent.setup();

    await user.click(
      within(await panel()).getByRole('button', { name: copy.clickup.panel.linkButton }),
    );
    const dialog = await screen.findByRole('dialog', { name: copy.clickup.linkDialog.title });
    await user.type(within(dialog).getByLabelText(copy.clickup.linkDialog.field), 'WB-999');
    await user.click(within(dialog).getByRole('button', { name: copy.clickup.linkDialog.confirm }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.task_not_found!);
  });
});
