// S-04-T6: the PR page shows the change type as plain grey text with how it was set, warns about a
// large PR and suggests splitting it, and Force type sends the unsigned change-type request.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { ChecksSectionView } from '@/lib/api-types.ts';
import { aChecks, aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const LARGE = aChecks({
  runId: 51,
  changeType: { value: 'changes_behaviour', reason: { code: 'judge_raised', params: {} } },
  largePr: { lines: 1240, threshold: 800 },
  ci: { passed: 4, failed: 0, pending: 0 },
  install: { status: 'ok' },
});

const openPr = (checks: ChecksSectionView, extra: Record<string, unknown> = {}) => {
  const stub = stubFetch({
    '/api/prs/wb/12': aPrView({ checks }),
    '/api/prs/wb/12/findings': aFindingsResponse(),
    ...extra,
  });
  renderApp('/pr/wb/12');
  return stub;
};

const panel = () => screen.findByRole('region', { name: copy.checks.panel.title });

describe('Change type and the large-PR warning on the PR page', () => {
  it('shows the change type in grey with how it was set, and the large-PR warning', async () => {
    openPr(LARGE);

    const region = await panel();
    const type = within(region).getByTestId('change-type');
    expect(type).toHaveTextContent('Changes behaviour · raised by the judge');
    expect(type).toHaveClass('text-text-3');
    expect(within(region).getByTestId('large-pr-warning')).toHaveTextContent(
      'Large PR. 1240 changed lines, over the 800-line limit. Consider splitting it into smaller PRs.',
    );
  });

  it('a PR under the threshold shows no warning; one with no round yet says what sets it', async () => {
    openPr(aChecks());

    const region = await panel();
    expect(region).toHaveTextContent(copy.checks.panel.none);
    expect(within(region).queryByTestId('large-pr-warning')).toBeNull();
  });

  it('Force type sends the chosen type, unsigned, and the panel names the forced next round', async () => {
    const forced = aChecks({ ...LARGE, forced: 'one_way_door' });
    const { calls } = openPr(LARGE, {
      'PUT /api/prs/wb/12/change-type': { checks: forced },
    });
    const user = userEvent.setup();

    const region = await panel();
    await user.click(within(region).getByRole('button', { name: copy.checks.panel.force }));
    await user.click(await screen.findByRole('combobox', { name: copy.checks.panel.forceLabel }));
    await user.click(await screen.findByRole('option', { name: 'One-way door' }));
    await user.click(screen.getByRole('button', { name: copy.checks.panel.save }));

    await expect
      .poll(() => calls.find((call) => call.method === 'PUT'))
      .toMatchObject({
        path: '/api/prs/wb/12/change-type',
        headers: { 'X-PRA-Request': '1' },
        body: { changeType: 'one_way_door' },
      });
  });

  it('shows the type forced for the next round', async () => {
    openPr(aChecks({ ...LARGE, forced: 'one_way_door' }));

    const region = await panel();
    expect(within(region).getByTestId('change-type-forced')).toHaveTextContent(
      'Next round: One-way door, forced',
    );
  });
});
