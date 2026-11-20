// S-22-T5: Settings → Instructions and the instruction editor. STAGEFILES: sections by kind, Read
// by, the unused toggle, New file, Make active on any version and Discard draft.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
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
  kind: 'instruction' as const,
  readBy: [{ stage: 'review' as const, repository: 'workflowbuilder' }],
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
      readBy: [{ stage: 'review', repository: null }],
      active: v1,
      draft: null,
    },
    { ...file, active: v1, draft: v2Draft },
    {
      ...file,
      id: 2,
      scope: 'global',
      repository: null,
      fileKey: 'lessons.md',
      kind: 'document',
      readBy: [
        { stage: 'review', repository: null },
        { stage: 'analyst', repository: null },
      ],
      active: v1,
      draft: null,
    },
    {
      ...file,
      id: 3,
      scope: 'global',
      repository: null,
      fileKey: 'review-levels.json',
      kind: 'document',
      readBy: [],
      active: v1,
      draft: null,
    },
  ],
  repositories: [{ id: 1, slug: 'workflowbuilder' }],
  gaps: [],
};

beforeEach(() => window.localStorage.clear());
afterEach(restoreFetch);

const callsTo = (calls: FetchCall[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

describe('Settings → Instructions', () => {
  test('lists instructions apart from documents, with scope, readers and versions', async () => {
    stubFetch({ '/api/instructions': list });
    renderApp('/settings/instructions');

    const instructions = await screen.findByRole('region', {
      name: t.sections.instruction!.title,
    });
    const prompt = within(instructions).getByRole('row', { name: /prompt-reviewer\.md/ });
    expect(prompt).toHaveTextContent(t.aboutPrompt('reviewer'));
    expect(prompt).toHaveTextContent(`${t.scope.global}Review`);
    const row = within(instructions).getByRole('row', { name: /review-rules\.md/ });
    expect(row).toHaveTextContent(t.about['review-rules.md']!);
    expect(row).toHaveTextContent('workflowbuilderReview (workflowbuilder)v1v2');

    const documents = screen.getByRole('region', { name: t.sections.document!.title });
    expect(within(documents).getByRole('row', { name: /lessons\.md/ })).toHaveTextContent(
      'Review, Analyst',
    );
    expect(within(documents).queryByRole('link', { name: 'review-levels.json' })).toBeNull();
    expect(screen.queryByRole('region', { name: t.gaps.title })).toBeNull();
  });

  test('files no stage reads show behind the toggle', async () => {
    stubFetch({ '/api/instructions': list });
    renderApp('/settings/instructions');

    await userEvent.click(await screen.findByRole('button', { name: t.showUnused(1) }));
    const documents = screen.getByRole('region', { name: t.sections.document!.title });
    expect(within(documents).getByRole('row', { name: /review-levels\.json/ })).toHaveTextContent(
      t.notUsed,
    );
    expect(screen.getByRole('button', { name: t.hideUnused })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('New file creates an unsigned draft and opens the editor', async () => {
    const created = detail(v2Draft);
    const { calls } = stubFetch({
      '/api/instructions': list,
      'POST /api/instructions': { status: 201, body: { ...created, file: { ...file, id: 7 } } },
      '/api/instructions/7': created,
    });
    const user = userEvent.setup();
    renderApp('/settings/instructions');

    await user.click(await screen.findByRole('button', { name: t.newFile.open }));
    const dialog = await screen.findByRole('dialog', { name: t.newFile.title });
    await user.type(
      within(dialog).getByRole('textbox', { name: t.newFile.key }),
      'strict-rules.md',
    );
    await user.click(within(dialog).getByRole('combobox', { name: t.newFile.scope }));
    await user.click(await screen.findByRole('option', { name: 'workflowbuilder' }));
    await user.type(within(dialog).getByRole('textbox', { name: t.newFile.content }), 'Be strict.');
    await user.click(within(dialog).getByRole('button', { name: t.newFile.create }));

    expect(await screen.findByRole('textbox', { name: t.editor.contentLabel })).toBeVisible();
    expect(callsTo(calls, 'POST', '/api/instructions')[0]!.body).toEqual({
      fileKey: 'strict-rules.md',
      kind: 'instruction',
      scope: 'repository',
      repository: 'workflowbuilder',
      content: 'Be strict.',
      note: null,
    });
  });

  test('New file shows why a name is refused', async () => {
    stubFetch({
      '/api/instructions': list,
      'POST /api/instructions': {
        status: 409,
        body: { error: { code: 'instruction_kind_conflict', params: { kind: 'document' } } },
      },
    });
    const user = userEvent.setup();
    renderApp('/settings/instructions');

    await user.click(await screen.findByRole('button', { name: t.newFile.open }));
    const dialog = await screen.findByRole('dialog', { name: t.newFile.title });
    await user.type(within(dialog).getByRole('textbox', { name: t.newFile.key }), 'lessons.md');
    await user.click(within(dialog).getByRole('button', { name: t.newFile.create }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      copy.errors.instruction_kind_conflict!,
    );
  });

  test('warns per repository about the files its rounds would miss, even with no file yet', async () => {
    const missing = ['prompt-verifier.md', 'verify-rules.md'];
    stubFetch({
      '/api/instructions': {
        files: [],
        repositories: [{ id: 1, slug: 'acme' }],
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
    expect(within(warning).getByRole('heading', { name: t.gaps.repository('acme') })).toBeVisible();
    const lines = within(warning).getAllByRole('listitem');
    expect(lines.map((li) => li.textContent)).toEqual([
      'Levels 3 and 4: Verify: prompt-verifier.md and verify-rules.md are missing',
      'Level 4: Implement: implement-rules.md is missing',
    ]);
    expect(screen.getByText(t.empty)).toBeInTheDocument();
  });
});

describe('the instruction editor', () => {
  test('names the kind of the file: instruction or document (KINDS)', async () => {
    const document = detail(v1);
    stubFetch({
      '/api/instructions/7': detail(v1),
      '/api/instructions/2': { ...document, file: { ...document.file, id: 2, kind: 'document' } },
      '/api/team': { members: [ola] },
    });
    const first = renderApp('/settings/instructions/7');
    expect(await screen.findByTestId('instruction-kind')).toHaveTextContent(
      t.kindName.instruction!,
    );
    first.unmount();
    renderApp('/settings/instructions/2');
    expect(await screen.findByTestId('instruction-kind')).toHaveTextContent(t.kindName.document!);
  });

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

  test('the history lists the runs that used each version, and offers Make active', async () => {
    stubFetch({
      '/api/instructions/7': detail(
        { ...v2Draft, status: 'active' },
        { ...v1, status: 'archived' },
      ),
    });
    renderApp('/settings/instructions/7');

    const history = await screen.findByRole('table', { name: t.history.tableLabel });
    expect(screen.getByText(t.history.hint)).toBeInTheDocument();
    const row = within(history).getByRole('row', { name: /^v1/ });
    expect(
      within(row).getByRole('link', { name: t.history.run('workflowbuilder', 272, 41) }),
    ).toHaveAttribute('href', '/runs/41');
    expect(
      within(row).getByRole('link', { name: t.history.run('workflowbuilder', 268, 40) }),
    ).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: t.history.makeActive(1) })).toBeInTheDocument();
    const v2Row = within(history).getByRole('row', { name: /^v2/ });
    expect(v2Row).toHaveTextContent(t.history.noRuns);
    expect(within(v2Row).queryByRole('button')).toBeNull();
  });

  test('Make active on an archived version that was never active posts it signed', async () => {
    const neverActive = { ...v2Draft, status: 'archived' as const };
    const { calls } = stubFetch({
      '/api/instructions/7': detail(neverActive, v1),
      '/api/team': { members: [ola] },
      'POST /api/instructions/7/activate': detail(
        { ...neverActive, status: 'active' },
        { ...v1, status: 'archived' },
      ),
      '/api/instructions': list,
    });
    window.localStorage.setItem(LAST_SIGNER_KEY, ola.id);
    renderApp('/settings/instructions/7');

    const history = await screen.findByRole('table', { name: t.history.tableLabel });
    await userEvent.click(within(history).getByRole('button', { name: t.history.makeActive(2) }));
    const dialog = await screen.findByRole('alertdialog', { name: t.activateDialog.title(2) });
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Ola'),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t.activateDialog.confirm }));

    await waitFor(() =>
      expect(callsTo(calls, 'POST', '/api/instructions/7/activate')).toHaveLength(1),
    );
    expect(callsTo(calls, 'POST', '/api/instructions/7/activate')[0]!.body).toEqual({
      versionId: 71,
      activeVersion: 1,
      signedBy: 'm-ola',
    });
  });

  test('Discard draft deletes it unsigned and the form goes back to the active text', async () => {
    const { calls } = stubFetch({
      '/api/instructions/7': detail(v2Draft, v1),
      'DELETE /api/instructions/7/draft': detail(v1),
      '/api/instructions': list,
    });
    renderApp('/settings/instructions/7');

    const text = await screen.findByRole('textbox', { name: t.editor.contentLabel });
    expect(text).toHaveValue(v2Draft.content);
    await userEvent.click(screen.getByRole('button', { name: t.editor.discardDraft }));

    expect(await screen.findByText(t.editor.draftDiscarded)).toBeInTheDocument();
    expect(text).toHaveValue(v1.content);
    expect(callsTo(calls, 'DELETE', '/api/instructions/7/draft')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: t.editor.discardDraft })).toBeNull();
  });

  test("discarding a file's only version goes back to the list", async () => {
    stubFetch({
      '/api/instructions/7': detail({ ...v2Draft, version: 1 }),
      'DELETE /api/instructions/7/draft': { status: 204, body: null },
      '/api/instructions': list,
    });
    renderApp('/settings/instructions/7');

    await userEvent.click(await screen.findByRole('button', { name: t.editor.discardDraft }));
    expect(
      await screen.findByRole('region', { name: t.sections.instruction!.title }),
    ).toBeInTheDocument();
  });
});
