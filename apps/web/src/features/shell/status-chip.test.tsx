import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aFindingsResponse, anEmptyBoard, aPrView } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const STATUS = { state: 'running', todaySpendUsd: 1.84, since: '2026-11-19T00:00:00.000Z' };

function stubAll() {
  stubFetch({
    '/api/status': STATUS,
    '/api/board': anEmptyBoard(),
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/activity/in-progress': { runs: [] },
    '/api/team': { members: [] },
  });
}

afterEach(restoreFetch);

describe('status chip', () => {
  it.each(['/prs', '/pr/wb/12', '/activity', '/settings/team'])('renders on %s', async (path) => {
    stubAll();
    renderApp(path);
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    const topBar = nav.closest('header')!;
    expect(
      await within(topBar).findByRole('button', { name: /Running · \$1\.84 today/ }),
    ).toBeVisible();
  });

  it('opens today’s spend and a link to Activity', async () => {
    stubAll();
    renderApp('/prs');
    const chip = await screen.findByRole('button', { name: /Running · \$1\.84 today/ });
    await userEvent.click(chip);
    const panel = await screen.findByRole('group', { name: 'Factory status' });
    expect(within(panel).getByText('Spent today')).toBeVisible();
    expect(within(panel).getByRole('link', { name: 'Open Activity' })).toHaveAttribute(
      'href',
      '/activity',
    );
  });

  it('shows nothing while the status cannot be read', async () => {
    stubFetch({ '/api/board': anEmptyBoard() });
    renderApp('/prs');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(screen.queryByRole('button', { name: /today/ })).toBeNull();
  });
});
