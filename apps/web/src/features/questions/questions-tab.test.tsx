// S-08-T2: the Questions tab.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { AnswerView, DecisionResult, TeamMember } from '@/lib/api-types.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import { aChecklist, aFindingsResponse, aNextStep, aPrView, aQuestion } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch, type StubbedResponse } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const kasia: TeamMember = {
  id: 'm-kasia',
  name: 'Kasia',
  githubLogin: 'kasia',
  clickupUserId: null,
};
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const cache = aQuestion({ id: 1, ordinal: 1, text: 'Should the cache survive a restart?' });
const scope = aQuestion({
  id: 2,
  ordinal: 2,
  text: 'Does the limit apply to admins?',
  options: ['Yes', 'No', 'Only in production'],
  recommended: 2,
});

const answerBy = (member: TeamMember, over: Partial<AnswerView> = {}): AnswerView => ({
  id: 50,
  option: 0,
  text: 'Yes',
  signedBy: { id: member.id, name: member.name },
  savedAt: '2026-11-19T12:00:00.000Z',
  ...over,
});

function stubPr(routes: Record<string, StubbedResponse | unknown> = {}) {
  return stubFetch({
    '/api/prs/wb/12': aPrView(),
    '/api/prs/wb/12/findings': aFindingsResponse({ questions: [cache, scope] }),
    '/api/team': { members: [kasia, tomek] },
    ...routes,
  });
}

const posts = (calls: { method: string; path: string }[]) =>
  calls.filter((c) => c.method === 'POST' && c.path === '/api/prs/wb/12/answers');

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

const questionCard = (text: string) => screen.findByRole('region', { name: text });

test('Save is enabled only when every question has an answer and a signer', async () => {
  window.localStorage.clear();
  const saved: DecisionResult = {
    nextStep: aNextStep({ state: 'findings_to_decide' }),
    checklist: aChecklist(),
    findings: aFindingsResponse({
      questions: [
        { ...cache, answer: answerBy(tomek, { id: 60, option: 1, text: 'No' }) },
        {
          ...scope,
          answer: answerBy(tomek, { id: 61, option: null, text: 'Admins are exempt.' }),
        },
      ],
    }),
  };
  // After the save, the refetched findings carry the answers.
  let findings = aFindingsResponse({ questions: [cache, scope] });
  const { calls } = stubFetch({
    '/api/prs/wb/12': aPrView(),
    get '/api/prs/wb/12/findings'() {
      return findings;
    },
    '/api/team': { members: [kasia, tomek] },
    get 'POST /api/prs/wb/12/answers'() {
      findings = saved.findings;
      return saved;
    },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=questions');

  const first = await questionCard(cache.text);
  const second = await questionCard(scope.text);
  // The recommended option is marked.
  expect(within(second).getByText('Only in production').closest('label')).toHaveTextContent(
    copy.questions.recommended,
  );
  const save = () => screen.getByRole('button', { name: /^Save/ });
  expect(save()).toBeDisabled();

  await user.click(within(first).getByRole('radio', { name: 'No' }));
  expect(save()).toBeDisabled();
  await user.type(within(second).getByRole('textbox'), 'Admins are exempt.');
  // Every question answered, but nobody signed yet.
  expect(save()).toHaveTextContent('Save 2 answers');
  expect(save()).toBeDisabled();

  await user.click(screen.getByRole('combobox'));
  await user.click(await screen.findByRole('option', { name: /Tomek/ }));
  expect(save()).toBeEnabled();
  await user.click(save());

  await waitFor(() => expect(posts(calls)).toHaveLength(1));
  expect((posts(calls)[0] as { body?: unknown }).body).toEqual({
    signedBy: tomek.id,
    answers: [
      { questionId: 1, option: 1, expectedAnswerId: null },
      { questionId: 2, ownText: 'Admins are exempt.', expectedAnswerId: null },
    ],
  });
  // Answered questions show the answer and who gave it.
  expect(await within(first).findByText(copy.questions.answeredBy('Tomek'))).toBeVisible();
  expect(within(second).getByText(/Admins are exempt\./)).toBeVisible();
  expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
});

test('a 409 shows who answered first', async () => {
  stubPr({
    'POST /api/prs/wb/12/answers': {
      status: 409,
      body: {
        error: {
          code: 'answer_conflict',
          params: { conflicts: [{ questionId: 1, answer: answerBy(kasia) }] },
        },
      },
    },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=questions');

  await user.click(within(await questionCard(cache.text)).getByRole('radio', { name: 'No' }));
  await user.click(within(await questionCard(scope.text)).getByRole('radio', { name: 'Yes' }));
  await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Tomek'));
  await user.click(screen.getByRole('button', { name: 'Save 2 answers' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(copy.questions.conflict(['Kasia']));
});
