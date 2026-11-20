// S-22-T10: Settings → Pipeline, the read-only diagram and a stage's Sheet; STAGEFILES: the scope
// picker and the stage files picked, inherited, reset and saved signed in the Sheet.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type {
  FileOption,
  PipelineResponse,
  PipelineStageView,
  StageFilesView,
  TeamMember,
} from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.pipeline;
const f = t.files;
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const stage = (patch: Partial<PipelineStageView> & Pick<PipelineStageView, 'key'>) =>
  ({
    role: null,
    model: null,
    tools: [],
    integrations: [],
    files: null,
    output: { schema: 'Output', fields: ['a'] },
    timeoutMinutes: 30,
    attempts: 1,
    repairs: 0,
    onFrom: 1,
    ...patch,
  }) satisfies PipelineStageView;

const option = (fileKey: string, patch: Partial<FileOption> = {}): FileOption => ({
  fileKey,
  kind: 'instruction',
  fileId: null,
  version: null,
  scope: null,
  ...patch,
});

const reviewRules = option('review-rules.md', { fileId: 4, version: 2, scope: 'global' });
const verifyRules = option('verify-rules.md', { fileId: 5, version: 1, scope: 'global' });
const verifyB = option('verify-b-rules.md', { fileId: 9, version: 3, scope: 'repository' });
const lessons = option('lessons.md', { kind: 'document', fileId: 6, version: 1, scope: 'global' });

const reviewFiles: StageFilesView = {
  choice: { global: null, repository: null },
  slots: [
    {
      name: 'prompt',
      kind: 'instruction',
      builtIn: true,
      required: false,
      source: 'default',
      value: ['@built-in'],
      files: [],
    },
    {
      name: 'rules',
      kind: 'instruction',
      builtIn: false,
      required: false,
      source: 'default',
      value: ['review-rules.md'],
      files: [reviewRules],
    },
    {
      name: 'documents',
      kind: 'document',
      builtIn: false,
      required: false,
      source: 'default',
      value: ['lessons.md'],
      files: [lessons],
    },
  ],
};

const verifyFiles = (
  rules: FileOption,
  source: 'default' | 'global' | 'repository',
  choice: StageFilesView['choice'] = { global: null, repository: null },
): StageFilesView => ({
  choice,
  slots: [
    {
      name: 'prompt',
      kind: 'instruction',
      builtIn: false,
      required: true,
      source: 'default',
      value: ['prompt-verifier.md'],
      files: [option('prompt-verifier.md', { copies: ['wb'] })],
    },
    {
      name: 'rules',
      kind: 'instruction',
      builtIn: false,
      required: true,
      source,
      value: [rules.fileKey],
      files: [rules],
    },
  ],
});

const pipeline = (
  patch: { repository?: string; verify?: StageFilesView; extra?: FileOption[] } = {},
): PipelineResponse => ({
  scope: { repository: patch.repository ? { id: 1, slug: patch.repository } : null },
  repositories: [{ id: 1, slug: 'wb' }],
  options: {
    instruction: [reviewRules, verifyRules, ...(patch.extra ?? [])],
    document: [lessons],
  },
  stages: [
    stage({ key: 'checks', onFrom: 2, integrations: ['GitHubGateway'] }),
    stage({
      key: 'review',
      role: 'reviewer',
      model: { model: 'claude-fable-5-2', source: 'settings', level: null },
      tools: ['Read', 'Grep', 'Glob'],
      files: reviewFiles,
      output: { schema: 'ReviewOutput', fields: ['summary', 'findings'] },
    }),
    stage({
      key: 'verify',
      role: 'verifier',
      onFrom: 3,
      repairs: 1,
      files: patch.verify ?? verifyFiles(verifyRules, 'default'),
    }),
    stage({ key: 'implement', role: 'implementer', onFrom: 4 }),
  ],
});

const puts = (calls: FetchCall[]) => calls.filter((c) => c.method === 'PUT');

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id);
});
afterEach(restoreFetch);

async function openStage(name: string, level: number) {
  await userEvent.click(await screen.findByRole('button', { name: t.node(name, level) }));
  return screen.findByRole('dialog', { name });
}

async function signAndSave(
  user: ReturnType<typeof userEvent.setup>,
  stageName: string,
  /** Checks the dialog before it is confirmed (it closes on success). */
  check: (dialog: HTMLElement) => void = () => {},
) {
  const dialog = await screen.findByRole('alertdialog', { name: f.dialogTitle(stageName) });
  check(dialog);
  await waitFor(() =>
    expect(within(dialog).getByRole('combobox', { name: copy.signature.label })).toHaveTextContent(
      'Tomek',
    ),
  );
  await user.click(within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }));
  return dialog;
}

test('one node per stage, labelled with its level, none of them draggable', async () => {
  stubFetch({ '/api/pipeline': pipeline() });
  const { container } = renderApp('/settings/pipeline');

  const diagram = await screen.findByRole('group', { name: t.diagramLabel });
  expect(within(diagram).getByRole('button', { name: t.node('Review', 1) })).toBeInTheDocument();
  expect(within(diagram).getByRole('button', { name: t.node('Verify', 3) })).toBeInTheDocument();
  const nodes = container.querySelectorAll('.react-flow__node');
  expect(nodes).toHaveLength(4);
  for (const node of nodes) {
    expect(node).not.toHaveClass('draggable');
    expect(node).not.toHaveClass('selectable');
    expect(node).not.toHaveClass('connectable');
  }
  expect(container.querySelector('.react-flow__handle.connectable')).toBeNull();
});

test('Enter on the Review node opens the Sheet with its model, tools and files', async () => {
  stubFetch({ '/api/pipeline': pipeline() });
  renderApp('/settings/pipeline');

  const review = await screen.findByRole('button', { name: t.node('Review', 1) });
  review.focus();
  await userEvent.keyboard('{Enter}');

  const sheet = await screen.findByRole('dialog', { name: 'Review' });
  expect(sheet).toHaveTextContent('claude-fable-5-2');
  expect(sheet).toHaveTextContent(t.modelSource.settings);
  expect(sheet).toHaveTextContent('Read, Grep, Glob');
  expect(
    within(sheet).getByRole('combobox', { name: f.pick('Review', 'Prompt') }),
  ).toHaveTextContent(f.builtIn);
  expect(within(sheet).getByRole('link', { name: 'review-rules.md v2' })).toHaveAttribute(
    'href',
    '/settings/instructions/4',
  );
  expect(within(sheet).getByRole('checkbox', { name: 'lessons.md' })).toBeChecked();
  expect(within(sheet).getAllByText(f.source.default)).toHaveLength(3);
  expect(within(sheet).getByRole('button', { name: f.save })).toBeDisabled();
  expect(sheet).toHaveTextContent('ReviewOutput: summary, findings');
  expect(sheet).toHaveTextContent(t.sheet.level(1));

  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('a code stage has no model and lists the services it calls', async () => {
  stubFetch({ '/api/pipeline': pipeline() });
  renderApp('/settings/pipeline');

  const sheet = await openStage('Checks', 2);
  expect(sheet).toHaveTextContent(t.noModel);
  expect(sheet).toHaveTextContent('GitHubGateway');
  expect(sheet).toHaveTextContent(t.sheet.noInstructions);
});

test('at Global scope a file kept only in a repository says where it lives', async () => {
  stubFetch({ '/api/pipeline': pipeline() });
  renderApp('/settings/pipeline');

  const sheet = await openStage('Verify', 3);
  expect(sheet).toHaveTextContent(t.sheet.fileVersion('prompt-verifier.md', null));
  expect(sheet).toHaveTextContent(f.onlyIn(['wb']));
});

test("picking a repository shows its copy's version, overridden for it", async () => {
  const atWb = pipeline({
    repository: 'wb',
    verify: verifyFiles(verifyB, 'repository', {
      global: null,
      repository: { rules: 'verify-b-rules.md' },
    }),
    extra: [verifyB],
  });
  const { calls } = stubFetch({ '/api/pipeline': pipeline(), '/api/pipeline?repository=wb': atWb });
  const user = userEvent.setup();
  renderApp('/settings/pipeline');

  await user.click(await screen.findByRole('combobox', { name: t.scope.label }));
  await user.click(await screen.findByRole('option', { name: 'wb' }));
  await waitFor(() =>
    expect(calls.some((c) => c.path === '/api/pipeline?repository=wb')).toBe(true),
  );

  const sheet = await openStage('Verify', 3);
  expect(within(sheet).getByRole('link', { name: 'verify-b-rules.md v3' })).toHaveAttribute(
    'href',
    '/settings/instructions/9',
  );
  const rules = within(sheet).getByRole('group', { name: f.slots.rules });
  expect(rules).toHaveTextContent(f.source.overridden);
  expect(within(sheet).getByRole('group', { name: f.slots.prompt })).toHaveTextContent(
    f.source.inherited,
  );
});

test('a repository override saves signed with the stored choice as before', async () => {
  const atWb = pipeline({ repository: 'wb', extra: [verifyB] });
  const { calls } = stubFetch({
    '/api/pipeline?repository=wb': atWb,
    '/api/team': { members: [tomek] },
    'PUT /api/settings/stage-files/verify': { stage: verifyFiles(verifyB, 'repository') },
  });
  const user = userEvent.setup();
  renderApp('/settings/pipeline?repository=wb');

  const sheet = await openStage('Verify', 3);
  await user.click(within(sheet).getByRole('combobox', { name: f.pick('Verify', 'Rules') }));
  await user.click(await screen.findByRole('option', { name: 'verify-b-rules.md' }));
  expect(within(sheet).getByRole('group', { name: f.slots.rules })).toHaveTextContent(
    f.source.overridden,
  );
  await user.click(within(sheet).getByRole('button', { name: f.save }));

  await signAndSave(user, 'Verify', (dialog) =>
    expect(within(dialog).getByRole('row', { name: /Rules/ })).toHaveTextContent(
      'Rulesverify-rules.mdverify-b-rules.md',
    ),
  );
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(puts(calls)[0]?.body).toEqual({
    repository: 'wb',
    before: null,
    after: { rules: 'verify-b-rules.md' },
    signedBy: tomek.id,
  });
  expect(await screen.findByText(f.saved)).toBeInTheDocument();
});

test('Reset goes back to the global files; a stale save shows the message', async () => {
  const stored = { rules: 'verify-b-rules.md' };
  const atWb = pipeline({
    repository: 'wb',
    verify: verifyFiles(verifyB, 'repository', { global: null, repository: stored }),
    extra: [verifyB],
  });
  const { calls } = stubFetch({
    '/api/pipeline?repository=wb': atWb,
    '/api/team': { members: [tomek] },
    'PUT /api/settings/stage-files/verify': {
      status: 409,
      body: { error: { code: 'settings_stale', params: {} } },
    },
  });
  const user = userEvent.setup();
  renderApp('/settings/pipeline?repository=wb');

  const sheet = await openStage('Verify', 3);
  await user.click(within(sheet).getByRole('button', { name: f.reset('Rules') }));
  expect(within(sheet).getByRole('group', { name: f.slots.rules })).toHaveTextContent(
    f.source.resetRepository,
  );
  await user.click(within(sheet).getByRole('button', { name: f.save }));

  const dialog = await signAndSave(user, 'Verify');
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(puts(calls)[0]?.body).toMatchObject({ repository: 'wb', before: stored, after: null });
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    copy.errors.settings_stale ?? '',
  );
});
