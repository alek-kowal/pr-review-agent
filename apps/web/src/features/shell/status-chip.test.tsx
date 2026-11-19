import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { money, setCostBasis } from '@/copy/format.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { aFindingsResponse, anEmptyBoard, aPrView, aStatus } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const STATUS = aStatus();

function stubAll(status = STATUS) {
  stubFetch({
    '/api/status': status,
    '/api/board': anEmptyBoard(),
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/activity/in-progress': { runs: [] },
    '/api/team': { members: [] },
  });
}

afterEach(() => {
  restoreFetch();
  setCostBasis('spend');
});

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

  it('names the API key mode and leaves amounts as spend', async () => {
    stubAll();
    renderApp('/prs');
    await userEvent.click(await screen.findByRole('button', { name: /Running · \$1\.84 today/ }));
    const line = await screen.findByTestId('model-auth');
    expect(line).toHaveTextContent('Model access');
    expect(line).toHaveTextContent('API key');
  });

  it('on a Claude subscription labels every amount API-equivalent', async () => {
    stubAll(aStatus({ modelAuth: 'subscription', dailyBudgetUsd: 10 }));
    renderApp('/prs');
    const chip = await screen.findByRole('button', {
      name: /Running · \$1\.84 of \$10\.00 API-equivalent today$/,
    });
    await userEvent.click(chip);
    const panel = await screen.findByRole('group', { name: 'Factory status' });
    expect(within(panel).getByTestId('model-auth')).toHaveTextContent('Claude subscription');
    expect(within(panel).getByText(/^API-equivalent: the API price/)).toBeVisible();
    expect(money(0.5)).toBe('$0.50 API-equivalent');
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
