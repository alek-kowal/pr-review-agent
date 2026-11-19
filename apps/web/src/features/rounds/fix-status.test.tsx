// S-07-T6: Resolved / Not resolved on findings decided Implement, and "X of Y fixes resolved".
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { DecisionView, FindingView } from '@/lib/api-types.ts';
import { aFinding, aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

const implement: DecisionView = {
  batchId: 7,
  decision: 'implement',
  reason: null,
  signedBy: { id: 'm-kasia', name: 'Kasia' },
  decidedAt: '2026-11-19T12:00:00.000Z',
};
const decided = { needed: false, reason: { code: 'decided', params: {} } };

const fixed = (id: number, title: string, resolved: boolean, reason: string): FindingView =>
  aFinding({
    id,
    title,
    decision: implement,
    needsDecision: decided,
    fix: { resolved, reason, runId: 9 },
  });

function open(findings: FindingView[]) {
  stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings }),
  });
  return renderApp('/pr/wb/12');
}

test('fix results carry Resolved / Not resolved and the count of resolved fixes', async () => {
  const user = userEvent.setup();
  open([
    fixed(1, 'Undo loses the group', true, 'Undo now restores the group.'),
    fixed(2, 'Labels overflow', false, 'Long labels still overflow the node.'),
    aFinding({ id: 3, title: 'Drag ignores the grid' }),
  ]);

  expect(await screen.findByTestId('fixes-resolved')).toHaveTextContent('1 of 2 fixes resolved');
  const badges = screen.getAllByTestId('fix-badge');
  expect(badges.map((b) => b.textContent)).toEqual([
    copy.findings.fix.resolved,
    copy.findings.fix.notResolved,
  ]);
  expect(badges[0]).toHaveAttribute('title', 'Undo now restores the group.');

  await user.click(screen.getByRole('button', { name: /Labels overflow/ }));
  expect(screen.getByTestId('fix-note')).toHaveTextContent('Long labels still overflow the node.');
});

test('all fixes resolved reads "2 of 2 fixes resolved"', async () => {
  open([
    fixed(1, 'Undo loses the group', true, 'Fixed.'),
    fixed(2, 'Labels overflow', true, 'Fixed.'),
  ]);
  const strip = await screen.findByTestId('fixes-resolved');
  expect(strip).toHaveTextContent('2 of 2 fixes resolved');
  expect(within(screen.getByTestId('findings-tab')).queryByTestId('fix-note')).toBeNull();
});

test('no fix check yet: no badge and no count', async () => {
  open([
    aFinding({ id: 1, title: 'Undo loses the group', decision: implement, needsDecision: decided }),
  ]);
  expect(await screen.findByText('Undo loses the group')).toBeInTheDocument();
  expect(screen.queryByTestId('fix-badge')).not.toBeInTheDocument();
  expect(screen.queryByTestId('fixes-resolved')).not.toBeInTheDocument();
});
