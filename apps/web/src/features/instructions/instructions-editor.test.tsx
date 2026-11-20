// S-22-T5: Settings → Instructions and the instruction editor.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type {
  InstructionDetailResponse,
  InstructionsListResponse,
  InstructionVersionView,
  TeamMember,
} from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.instructions;
const ola: TeamMember = { id: 'm-ola', name: 'Ola', githubLogin: 'ola', clickupUserId: null };
const file = {
  id: 7,
  scope: 'repository' as const,
  repository: { id: 1, slug: 'workflowbuilder' },
  level: null,
  fileKey: 'review-rules.md',
};

const version = (patch: Partial<InstructionVersionView>): InstructionVersionView => ({
  id: 70,
  version: 1,
  note: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  activatedAt: '2026-11-01T10:00:00.000Z',
  status: 'active',
  content: 'Check types.\nCheck tests.\n',
  author: 'bot',
  authorName: null,
  signerName: null,
  runCount: 0,
  runs: [],
  ...patch,
});

const v1 = version({
  runCount: 2,
  runs: [
    {
      runId: 41,
      kind: 'round',
      repositorySlug: 'workflowbuilder',
      prNumber: 272,
      createdAt: '2026-11-02T10:00:00.000Z',
    },
    {
      runId: 40,
      kind: 'round',
      repositorySlug: 'workflowbuilder',
      prNumber: 268,
      createdAt: '2026-11-02T09:00:00.000Z',
    },
  ],
});
const v2Draft = version({
  id: 71,
  version: 2,
  status: 'draft',
  content: 'Check types.\nCheck public API names.\n',
  note: 'Name the API rule',
  author: 'hand',
  activatedAt: null,
});

const detail = (...versions: InstructionVersionView[]): InstructionDetailResponse => ({
  file,
  versions,
});

const list: InstructionsListResponse = {
  files: [
    {
      ...file,
      id: 1,
      scope: 'global',
      repository: null,
      fileKey: 'prompt-reviewer.md',
      active: v1,
      draft: null,
    },
    { ...file, active: v1, draft: v2Draft },
  ],
  gaps: [],
};

beforeEach(() => window.localStorage.clear());
afterEach(restoreFetch);

const callsTo = (calls: FetchCall[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

describe('Settings → Instructions', () => {
  test('lists files grouped by scope with the active version and the draft', async () => {
    stubFetch({ '/api/instructions': list });
    renderApp('/settings/instructions');

    const global = await screen.findByRole('region', { name: t.groups.global });
    expect(within(global).getByRole('link', { name: 'prompt-reviewer.md' })).toBeInTheDocument();
    const wb = screen.getByRole('region', { name: t.groups.repository('workflowbuilder') });
    const row = within(wb).getByRole('row', { name: /review-rules\.md/ });
    expect(row).toHaveTextContent('v1v2Name the API rule');
    expect(screen.queryByRole('region', { name: t.gaps.title })).toBeNull();
  });

  test('warns per repository about the files its rounds would miss, even with no file yet', async () => {
    const missing = ['prompt-verifier.md', 'verify-rules.md'];
    stubFetch({
      '/api/instructions': {
        files: [],
        gaps: [
          {
            repository: { id: 1, slug: 'acme' },
            gaps: [
              { level: 4, stage: 'verify', missing },
              { level: 3, stage: 'verify', missing },
              { level: 4, stage: 'implement', missing: ['implement-rules.md'] },
            ],
          },
        ],
      } satisfies InstructionsListResponse,
    });
    renderApp('/settings/instructions');

    const warning = await screen.findByRole('region', { name: t.gaps.title });
    expect(
      within(warning).getByRole('heading', { name: t.groups.repository('acme') }),
    ).toBeVisible();
    const lines = within(warning).getAllByRole('listitem');
    expect(lines.map((li) => li.textContent)).toEqual([
      'Levels 3 and 4: Verify: prompt-verifier.md and verify-rules.md are missing',
      'Level 4: Implement: implement-rules.md is missing',
    ]);
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });
});

describe('the instruction editor', () => {
  test('the diff shows added and removed lines as you type', async () => {
    stubFetch({ '/api/instructions/7': detail(v1), '/api/team': { members: [ola] } });
    renderApp('/settings/instructions/7');

    const text = await screen.findByRole('textbox', { name: t.editor.contentLabel });
    expect(screen.getByText(t.editor.noChanges)).toBeInTheDocument();
    await userEvent.clear(text);
    await userEvent.type(text, 'Check types.{enter}Check docs.{enter}');

    const diff = screen.getByRole('region', { name: t.editor.diffLabel(1) });
    expect(diff.querySelector('ins')).toHaveTextContent('Check docs.');
    expect(diff.querySelector('del')).toHaveTextContent('Check tests.');
    expect(diff).toHaveTextContent(t.editor.diffSummary(1, 1));
  });

  test('Save as draft sends the text and note with no signature', async () => {
    const { calls } = stubFetch({
      '/api/instructions/7': detail(v1),
      'PUT /api/instructions/7/draft': detail(v2Draft, v1),
      '/api/instructions': list,
    });
    renderApp('/settings/instructions/7');

    const text = await screen.findByRole('textbox', { name: t.editor.contentLabel });
    expect(screen.getByRole('button', { name: t.editor.tryOnPr })).toBeDisabled();
    await userEvent.type(text, 'Check docs.');
    await userEvent.type(screen.getByRole('textbox', { name: t.editor.noteLabel }), 'Docs rule');
    await userEvent.click(screen.getByRole('button', { name: t.editor.saveDraft }));

    expect(await screen.findByText(t.editor.draftSaved)).toBeInTheDocument();
    const [put] = callsTo(calls, 'PUT', '/api/instructions/7/draft');
    expect(put!.body).toEqual({
      content: 'Check types.\nCheck tests.\nCheck docs.',
      note: 'Docs rule',
    });
    expect(put!.body).not.toHaveProperty('signedBy');
  });

  test('Activate needs a signature, then posts the draft with the signer', async () => {
    const { calls } = stubFetch({
      '/api/instructions/7': detail(v2Draft, v1),
      '/api/team': { members: [ola] },
      'POST /api/instructions/7/activate': detail(
        { ...v2Draft, status: 'active', signerName: 'Ola' },
        { ...v1, status: 'archived' },
      ),
      '/api/instructions': list,
    });
    renderApp('/settings/instructions/7');

    await userEvent.click(await screen.findByRole('button', { name: t.editor.activate(2) }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('row', { name: /Active version/ })).toHaveTextContent('v1v2');
    expect(within(dialog).getByRole('row', { name: /Lines/ })).toHaveTextContent('+1 −1');

    await userEvent.click(within(dialog).getByRole('button', { name: t.activateDialog.confirm }));
    expect(await within(dialog).findByText(copy.signature.required)).toBeInTheDocument();
    expect(callsTo(calls, 'POST', '/api/instructions/7/activate')).toEqual([]);

    await userEvent.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
    await userEvent.click(await screen.findByRole('option', { name: /Ola/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: t.activateDialog.confirm }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(callsTo(calls, 'POST', '/api/instructions/7/activate')[0]!.body).toEqual({
      versionId: 71,
      activeVersion: 1,
      signedBy: 'm-ola',
    });
  });

  test('the history lists the runs that used each version, and offers rollback', async () => {
    stubFetch({
      '/api/instructions/7': detail(
        { ...v2Draft, status: 'active' },
        { ...v1, status: 'archived' },
      ),
    });
    renderApp('/settings/instructions/7');

    const history = await screen.findByRole('table', { name: t.history.tableLabel });
    const row = within(history).getByRole('row', { name: /^v1/ });
    expect(
      within(row).getByRole('link', { name: t.history.run('workflowbuilder', 272, 41) }),
    ).toHaveAttribute('href', '/runs/41');
    expect(
      within(row).getByRole('link', { name: t.history.run('workflowbuilder', 268, 40) }),
    ).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: t.history.rollback(1) })).toBeInTheDocument();
    const v2Row = within(history).getByRole('row', { name: /^v2/ });
    expect(v2Row).toHaveTextContent(t.history.noRuns);
  });
});
