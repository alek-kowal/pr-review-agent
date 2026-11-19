// S-07-T6: findings from an earlier commit stay usable and say how far behind they are.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { aFinding, aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

function open(findings: ReturnType<typeof aFinding>[]) {
  stubFetch({
    '/api/prs/wb/12': aPrView({
      head: { reviewedSha: 'abc1234def', headSha: 'fff9999', commitsSince: 2 },
    }),
    '/api/prs/wb/12/findings': aFindingsResponse({ findings }),
  });
  return renderApp('/pr/wb/12');
}

test('findings from an earlier commit show "From abc1234 · 2 commits behind"', async () => {
  open([
    aFinding({ id: 1, title: 'Undo loses the group', sourceSha: 'abc1234def', commitsBehind: 2 }),
    aFinding({ id: 2, title: 'Labels overflow', sourceSha: 'abc1234def', commitsBehind: 2 }),
  ]);

  const strip = await screen.findByTestId('findings-behind');
  expect(strip).toHaveTextContent('From abc1234 · 2 commits behind');
  expect(strip).toHaveTextContent(copy.findings.behindHint);
});

test('they stay usable: an open finding still offers the decisions', async () => {
  const user = userEvent.setup();
  open([
    aFinding({ id: 1, title: 'Undo loses the group', sourceSha: 'abc1234', commitsBehind: 1 }),
  ]);

  expect(await screen.findByTestId('findings-behind')).toHaveTextContent('1 commit behind');
  await user.click(screen.getByRole('button', { name: /Undo loses the group/ }));
  const tab = screen.getByTestId('findings-tab');
  expect(within(tab).getByRole('button', { name: copy.decisions.actions.implement })).toBeEnabled();
});

test('findings on the current head show no strip', async () => {
  open([aFinding({ id: 1, title: 'Undo loses the group' })]);
  expect(await screen.findByText('Undo loses the group')).toBeInTheDocument();
  expect(screen.queryByTestId('findings-behind')).not.toBeInTheDocument();
});
