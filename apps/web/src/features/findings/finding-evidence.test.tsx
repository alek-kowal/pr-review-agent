// S-05-T3: a finding's verdict, quoted evidence and the reproduction under technical details.
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import type { FindingView } from '@/lib/api-types.ts';
import { aFinding, aFindingsResponse, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

afterEach(restoreFetch);

function openFindings(findings: FindingView[], level: number) {
  stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse({
      round: { id: 1, number: 1, level: { number: level, key: 'verify' }, finishedAt: null },
      findings,
      unchecked: level < 3 ? findings.length : null,
    }),
  });
  return renderApp('/pr/wb/12?tab=findings');
}

async function openFinding(title: string) {
  const article = await screen.findByRole('article', { name: new RegExp(`: ${title}$`) });
  await userEvent.setup().click(within(article).getByRole('button', { expanded: false }));
  return article;
}

test('a Confirmed finding shows quotes as code and its reproduction with exit 0 under technical details', async () => {
  const user = userEvent.setup();
  openFindings(
    [
      aFinding({
        severity: 'blocking',
        title: 'Labels lose their text',
        verdict: 'confirmed',
        evidence: [{ file: 'src/edges.ts', line: 3, quote: 'return edge.name.trim();' }],
        verification: {
          reason: { code: 'repro_reproduced', params: {} },
          verifierReason: 'An empty name reaches the label.',
          reproduction: { exitCode: 0, timedOut: false, outputTail: 'label: ""', repaired: true },
        },
      }),
    ],
    3,
  );

  const article = await openFinding('Labels lose their text');
  expect(within(article).getByTestId('verdict')).toHaveTextContent('Confirmed');
  expect(within(article).getByText('Verifier: confirmed')).toBeInTheDocument();
  expect(within(article).getByText('An empty name reaches the label.')).toBeInTheDocument();
  const quote = within(article).getByText('return edge.name.trim();');
  expect(quote.tagName).toBe('PRE');
  expect(within(article).getByText('src/edges.ts:3')).toBeInTheDocument();

  const details = within(article).getByText('Technical details');
  expect(within(article).getByText(/exit 0: reproduced/)).not.toBeVisible();
  await user.click(details);
  expect(within(article).getByText(/exit 0: reproduced/)).toBeVisible();
  expect(within(article).getByText('label: ""')).toBeVisible();
  expect(within(article).getByText(/this is the repaired one/)).toBeVisible();
});

test('a Not proven finding without quotes shows no evidence block and no reproduction', async () => {
  openFindings(
    [
      aFinding({
        title: 'Undo may skip a step',
        verdict: 'not_proven',
        verification: {
          reason: { code: 'no_evidence', params: {} },
          verifierReason: 'Could not find the caller.',
          reproduction: null,
        },
      }),
    ],
    3,
  );

  const article = await openFinding('Undo may skip a step');
  expect(within(article).getByTestId('verdict')).toHaveTextContent('Not proven');
  expect(within(article).getByText('Could not find the caller.')).toBeInTheDocument();
  expect(within(article).queryByText('Evidence quoted from the code')).toBeNull();
  expect(within(article).queryByText('Technical details')).toBeNull();
});

test('a level-2 round shows "Unchecked (level 2)" on every finding', async () => {
  openFindings(
    [
      aFinding({ severity: 'blocking', title: 'First' }),
      aFinding({ title: 'Second' }),
      aFinding({ severity: 'nit', title: 'Third' }),
    ],
    2,
  );

  await screen.findByTestId('findings-tab');
  const verdicts = screen.getAllByTestId('verdict');
  expect(verdicts).toHaveLength(3);
  for (const verdict of verdicts) expect(verdict).toHaveTextContent('Unchecked (level 2)');

  const article = await openFinding('First');
  expect(within(article).getByText(/start a review at level 3/)).toBeInTheDocument();
});
