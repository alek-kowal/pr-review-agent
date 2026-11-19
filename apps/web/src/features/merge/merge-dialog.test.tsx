// S-12-T4: the Ready to merge banner's "Merge #12…" and its dialog: the typed number and a signer
// unlock Merge, GitHub's refusal and the failing rows show in the dialog, success closes it.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { MergeResponse, NextStepView, PrView, TeamMember } from '@/lib/api-types.ts';
import { aChecklist, aFindingsResponse, aNextStep, anAuthor, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
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

const mergeAction: NonNullable<NextStepView['mainAction']> = {
  action: 'merge',
  signed: true,
  optional: false,
  disabled: null,
  stage: null,
};

const green = aChecklist({
  ok: true,
  items: aChecklist().items.map((item) => ({ ...item, ok: true })),
});

const ready: PrView = aPrView({
  author: anAuthor({ login: 'kasia', memberId: kasia.id, name: kasia.name }),
  head: { reviewedSha: 'abc1234def', headSha: 'abc1234def' },
  nextStep: aNextStep({
    state: 'ready_to_merge',
    lane: 'ready_to_merge',
    tone: 'ready',
    banner: { code: 'state_ready_to_merge', params: { sha: 'abc1234def' } },
    who: { code: 'who_usually_author', params: { author: 'kasia' } },
    mainAction: mergeAction,
  }),
  checklist: green,
});

const merged: MergeResponse = {
  sha: 'abc1234def',
  mergeSha: 'fff9999aaa',
  by: { id: tomek.id, name: tomek.name },
};

const MERGE = 'POST /api/prs/wb/12/merge';

function serve(routes: Record<string, unknown> = {}) {
  return stubFetch({
    '/api/prs/wb/12': ready,
    '/api/prs/wb/12/findings': aFindingsResponse(),
    '/api/team': { members: [kasia, tomek] },
    ...routes,
  });
}

/** Opens the dialog from the banner. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const banner = await screen.findByTestId('next-step');
  await user.click(within(banner).getByRole('button', { name: 'Merge #12…' }));
  return screen.findByRole('alertdialog', { name: 'Merge #12' });
}

const typeNumber = (dialog: HTMLElement) =>
  within(dialog).getByRole('textbox', { name: 'Type 12 to confirm' });
const mergeButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Merge #12' });

afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

describe('Merge dialog', () => {
  test('shows the squash merge, the green checklist and the fresh check', async () => {
    serve();
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent(
      'Squash merge at abc1234 into main. Cannot be undone from here.',
    );
    expect(dialog).toHaveTextContent('Merge checklist: 2 of 2 pass');
    expect(dialog).toHaveTextContent(copy.merge.freshCheck);
    expect(dialog).toHaveTextContent(copy.merge.signatureHint);
  });

  test('Merge stays disabled until the typed number matches and a signer is picked', async () => {
    const { calls } = serve({ [MERGE]: merged });
    const user = userEvent.setup();
    renderApp('/pr/wb/12');

    const dialog = await openDialog(user);
    expect(mergeButton(dialog)).toBeDisabled();

    await user.type(typeNumber(dialog), '1x');
    expect(typeNumber(dialog)).toHaveValue('1');
    expect(mergeButton(dialog)).toBeDisabled();
    await user.type(typeNumber(dialog), '2');
    expect(mergeButton(dialog)).toBeDisabled();
    expect(mergeButton(dialog)).toHaveAttribute('title', copy.merge.pickSigner);

    await user.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
    await user.click(await screen.findByRole('option', { name: /Tomek/ }));
    expect(mergeButton(dialog)).toBeEnabled();

    await user.type(typeNumber(dialog), '3');
    expect(mergeButton(dialog)).toBeDisabled();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  describe('with a remembered signer', () => {
    beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));

    test('merges, signed, and closes with "#12 merged by Tomek"', async () => {
      const { calls } = serve({ [MERGE]: merged });
      const user = userEvent.setup();
      renderApp('/pr/wb/12');

      const dialog = await openDialog(user);
      await user.type(typeNumber(dialog), '12');
      await user.click(mergeButton(dialog));

      await waitFor(() =>
        expect(calls.find((c) => c.method === 'POST')).toMatchObject({
          path: '/api/prs/wb/12/merge',
          body: { typedNumber: 12, signedBy: tomek.id },
          headers: expect.objectContaining({ 'X-PRA-Request': '1' }),
        }),
      );
      expect(await screen.findByText('#12 merged by Tomek')).toBeVisible();
      expect(screen.getByText(copy.merge.mergedHint('abc1234def'))).toBeVisible();
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    test("a 422 shows GitHub's message in the dialog", async () => {
      const message = 'Required status check "e2e" is expected.';
      serve({
        [MERGE]: {
          status: 422,
          body: { error: { code: 'merge_refused', params: { status: 405, message } } },
        },
      });
      const user = userEvent.setup();
      renderApp('/pr/wb/12');

      const dialog = await openDialog(user);
      await user.type(typeNumber(dialog), '12');
      await user.click(mergeButton(dialog));

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(`GitHub refused the merge: ${message}`);
      expect(dialog).toBeVisible();
    });

    test('a 409 merge_not_ready lists the rows that failed on fresh GitHub state', async () => {
      serve({
        [MERGE]: {
          status: 409,
          body: {
            error: {
              code: 'merge_not_ready',
              params: {
                items: [
                  {
                    item: 'ci_green',
                    reason: {
                      code: 'checklist_ci_failing',
                      params: { failed: 1, total: 2, names: ['e2e'] },
                    },
                  },
                ],
              },
            },
          },
        },
      });
      const user = userEvent.setup();
      renderApp('/pr/wb/12');

      const dialog = await openDialog(user);
      await user.type(typeNumber(dialog), '12');
      await user.click(mergeButton(dialog));

      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent(copy.merge.notReady);
      expect(alert).toHaveTextContent('CI green in GitHub');
      expect(alert).toHaveTextContent('1 of 2 checks failing: e2e.');
    });

    test('a moved head says so', async () => {
      serve({
        [MERGE]: {
          status: 409,
          body: {
            error: {
              code: 'head_moved',
              params: { reviewedSha: 'abc1234def', headSha: 'bbb2222ccc' },
            },
          },
        },
      });
      const user = userEvent.setup();
      renderApp('/pr/wb/12');

      const dialog = await openDialog(user);
      await user.type(typeNumber(dialog), '12');
      await user.click(mergeButton(dialog));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        copy.merge.headMoved('bbb2222ccc'),
      );
    });
  });
});

test('the timeline names a merge from the app and a refusal', () => {
  const context = { stage: String, reason: String };
  const { entries } = copy.timeline;
  expect(entries.pr_merged!({ via: 'app', sha: 'abc1234def' }, context)).toBe(
    'Squash-merged at abc1234',
  );
  expect(entries.pr_merged!({}, context)).toBe('PR merged');
  expect(entries.merge_refused!({ sha: 'abc1234def', message: 'Review required.' }, context)).toBe(
    'GitHub refused the merge at abc1234: Review required.',
  );
});
