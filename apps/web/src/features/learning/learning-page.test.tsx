// S-23-T5: Settings → Learning. Accept waits for 2 PRs (disabled, with the reason), Reject needs a
// reason and a signature, and an accepted lesson shows its lessons.md version.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { LessonCandidateView, TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const ola: TeamMember = { id: 'm-ola', name: 'Ola', githubLogin: 'ola', clickupUserId: null };

const aCandidate = (patch: Partial<LessonCandidateView>): LessonCandidateView => ({
  id: 1,
  repo: 'wb',
  title: 'Snapshot tables in tests',
  text: 'Assert tables with a snapshot.',
  evidence: 'Asked twice in review.',
  status: 'proposed',
  prCount: 2,
  need: 2,
  sources: [
    { repo: 'wb', number: 270, title: 'Table export', evidence: '' },
    { repo: 'wb', number: 278, title: 'Table sort', evidence: '' },
  ],
  rejectReason: null,
  decidedBy: null,
  decidedAt: null,
  lessonsVersion: null,
  editedAt: null,
  createdAt: '2026-11-19T10:00:00.000Z',
  ...patch,
});

const twoPrs = aCandidate({ id: 1 });
const onePr = aCandidate({
  id: 2,
  title: 'Name hooks after the event',
  text: 'Hooks are named onX.',
  prCount: 1,
  sources: [{ repo: 'wb', number: 275, title: 'Hooks', evidence: '' }],
});
const accepted = aCandidate({
  id: 3,
  title: 'Keep migrations small',
  status: 'accepted',
  lessonsVersion: 4,
  decidedBy: 'Ola',
});

function serve(routes: Record<string, unknown> = {}) {
  return stubFetch({
    '/api/learning/candidates': { candidates: [twoPrs, onePr, accepted] },
    '/api/team': { members: [ola] },
    ...routes,
  });
}

const card = (title: string) => screen.findByRole('article', { name: title });

afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

describe('Settings → Learning', () => {
  test('at 1 PR Accept is disabled and says why', async () => {
    serve();
    const user = userEvent.setup();
    renderApp('/settings/learning');

    const one = await card(onePr.title);
    const acceptButton = within(one).getByRole('button', { name: copy.learning.accept.open });
    expect(acceptButton).toBeDisabled();
    expect(one).toHaveTextContent('1 of 2 PRs: waits for one more');

    await user.hover(acceptButton.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('1 of 2 PRs: waits for one more');

    const two = await card(twoPrs.title);
    expect(within(two).getByRole('button', { name: copy.learning.accept.open })).toBeEnabled();
    expect(two).toHaveTextContent('2 PRs');
  });

  test('Reject needs a reason and a signature', async () => {
    const { calls } = serve({
      'POST /api/learning/candidates/1/reject': { ...twoPrs, status: 'rejected' },
    });
    const user = userEvent.setup();
    renderApp('/settings/learning');

    await user.click(
      within(await card(twoPrs.title)).getByRole('button', { name: copy.learning.reject.open }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: copy.learning.reject.title(twoPrs.title),
    });
    const submit = within(dialog).getByRole('button', { name: copy.learning.reject.submit });

    await user.click(submit);
    expect(dialog).toHaveTextContent(copy.learning.reject.reasonRequired);

    await user.type(
      within(dialog).getByRole('textbox', { name: copy.learning.reject.reason }),
      'Too specific to one PR.',
    );
    await user.click(submit);
    expect(dialog).toHaveTextContent(copy.errors.signature_required!);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);

    await user.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
    await user.click(await screen.findByRole('option', { name: /Ola/ }));
    await user.click(submit);

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/learning/candidates/1/reject',
        body: { reason: 'Too specific to one PR.', signedBy: ola.id, text: twoPrs.text },
      }),
    );
  });

  test('Accept at 2 PRs is signed', async () => {
    const { calls } = serve({
      'POST /api/learning/candidates/1/accept': {
        ...twoPrs,
        status: 'accepted',
        lessonsVersion: 5,
      },
    });
    const user = userEvent.setup();
    renderApp('/settings/learning');

    await user.click(
      within(await card(twoPrs.title)).getByRole('button', { name: copy.learning.accept.open }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: copy.learning.accept.title(twoPrs.title),
    });
    await user.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
    await user.click(await screen.findByRole('option', { name: /Ola/ }));
    await user.click(within(dialog).getByRole('button', { name: copy.learning.accept.submit }));

    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/api/learning/candidates/1/accept',
        body: { signedBy: ola.id, text: twoPrs.text },
      }),
    );
  });

  test('an accepted lesson shows its lessons.md version', async () => {
    serve();
    renderApp('/settings/learning');

    const section = await screen.findByRole('region', { name: copy.learning.accepted });
    await within(section).findByText(accepted.title);
    expect(section).toHaveTextContent('lessons.md v4');
    expect(section).toHaveTextContent('Accepted by Ola');
  });
});
