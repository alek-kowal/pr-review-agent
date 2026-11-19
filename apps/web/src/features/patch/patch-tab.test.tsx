// S-13-T6: the Patch tab renders one diff per file, edits, reverts and revises the patch, and holds
// a new reproduction result behind "View new results".
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { PatchDetail, PatchFileView, PatchSummaryView } from '@/lib/api-types.ts';
import { aPatchSummary, aPrView } from '@/test/fixtures.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.implementer.patch;

const aFile = (over: Partial<PatchFileView> = {}): PatchFileView => ({
  path: 'src/group.ts',
  status: 'changed',
  blobKey: 'blob-group',
  base: 'export const a = 1;\n',
  content: 'export const a = 2;\n',
  diff: '--- a/src/group.ts\n+++ b/src/group.ts\n@@ -1,1 +1,1 @@\n-export const a = 1;\n+export const a = 2;\n',
  ...over,
});
const GROUP = aFile();
const SNAP = aFile({
  path: 'src/snap.ts',
  blobKey: 'blob-snap',
  base: 'grid = 8\n',
  content: 'grid = 16\n',
  diff: '--- a/src/snap.ts\n+++ b/src/snap.ts\n@@ -1,1 +1,1 @@\n-grid = 8\n+grid = 16\n',
});

const detailOf = (patch: PatchSummaryView, files: PatchFileView[]): PatchDetail => ({
  patch,
  files,
});

function stubPatch(patch: PatchSummaryView = aPatchSummary(), extra: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/api/prs/wb/12': aPrView({ implementer: { patch } }),
    '/api/prs/wb/12/findings': { body: {} },
    [`/api/patches/${patch.id}`]: detailOf(patch, [GROUP, SNAP]),
    ...extra,
  };
  return { routes, ...stubFetch(routes) };
}

afterEach(restoreFetch);

test('renders one diff per file under the summary line from the API', async () => {
  stubPatch();
  renderApp('/pr/wb/12?tab=patch');

  expect(await screen.findByTestId('patch-summary')).toHaveTextContent(
    '2 of 2 fixed · reproductions pass',
  );
  const files = screen.getAllByTestId('patch-file');
  expect(files).toHaveLength(2);
  expect(screen.getAllByTestId('patch-diff')).toHaveLength(2);
  expect(within(files[0]!).getByText('+export const a = 2;')).toBeVisible();
  expect(within(files[1]!).getByText('-grid = 8')).toBeVisible();
});

test.each([
  ['fail', 'reproductions fail'],
  ['not_run', 'reproductions not run'],
] as const)('the reproduction text matches the API (%s)', async (reproductions, text) => {
  stubPatch(aPatchSummary({ fixed: 1, reproductions }));
  renderApp('/pr/wb/12?tab=patch');

  expect(await screen.findByTestId('patch-summary')).toHaveTextContent(`1 of 2 fixed · ${text}`);
});

test('Edit sends the new content with the revision and the file blob key', async () => {
  const edited = aFile({
    status: 'edited',
    blobKey: 'blob-group-2',
    content: 'export const a = 3;\n',
  });
  const { calls } = stubPatch(undefined, {
    'PUT /api/patches/5/files': detailOf(aPatchSummary({ checking: true }), [edited, SNAP]),
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=patch');

  const file = await screen.findByRole('region', { name: 'src/group.ts' });
  await user.click(within(file).getByRole('button', { name: t.edit }));
  const editor = within(file).getByRole('textbox', { name: t.editLabel('src/group.ts') });
  await user.clear(editor);
  await user.type(editor, 'export const a = 3;');
  await user.click(within(file).getByRole('button', { name: t.save }));

  await waitFor(() =>
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      path: 'src/group.ts',
      revision: 1,
      blobKey: 'blob-group',
      content: 'export const a = 3;',
    }),
  );
  expect(await screen.findByText(t.checking)).toBeVisible();
});

test('Revert removes the file from the list', async () => {
  const reverted = aFile({ status: 'reverted', blobKey: null, content: null, diff: '' });
  const { calls } = stubPatch(undefined, {
    'POST /api/patches/5/files/revert': detailOf(aPatchSummary(), [reverted, SNAP]),
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=patch');

  await user.click(await screen.findByRole('button', { name: t.revertLabel('src/group.ts') }));

  await waitFor(() => expect(screen.getAllByTestId('patch-file')).toHaveLength(1));
  expect(screen.queryByRole('region', { name: 'src/group.ts' })).toBeNull();
  expect(calls.find((c) => c.path === '/api/patches/5/files/revert')?.body).toEqual({
    path: 'src/group.ts',
    revision: 1,
    blobKey: 'blob-group',
  });
});

test('a stale revert loads the patch again and says why', async () => {
  const { calls } = stubPatch(undefined, {
    'POST /api/patches/5/files/revert': {
      status: 409,
      body: { error: { code: 'patch_stale', params: { revision: 1 } } },
    },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=patch');

  await user.click(await screen.findByRole('button', { name: t.revertLabel('src/group.ts') }));

  expect(await screen.findByText(copy.errors.patch_stale)).toBeVisible();
  await waitFor(() =>
    expect(calls.filter((c) => c.path === '/api/patches/5' && c.method === 'GET')).toHaveLength(2),
  );
});

test('Revise needs a note, then sends it', async () => {
  const { calls } = stubPatch(undefined, {
    'POST /api/patches/5/revise': { status: 202, body: { runId: 42, findingIds: [1, 2] } },
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=patch');

  const form = await screen.findByRole('form', { name: t.revise.label });
  await user.click(within(form).getByRole('button', { name: t.revise.submit }));
  expect(within(form).getByRole('alert')).toHaveTextContent(copy.errors.note_required!);
  expect(calls.some((c) => c.path === '/api/patches/5/revise')).toBe(false);

  await user.type(within(form).getByLabelText(t.revise.noteLabel), 'Keep the old grid size');
  await user.click(within(form).getByRole('button', { name: t.revise.submit }));
  await waitFor(() =>
    expect(calls.find((c) => c.path === '/api/patches/5/revise')?.body).toEqual({
      note: 'Keep the old grid size',
    }),
  );
});

test('a new reproduction result waits behind "View new results"', async () => {
  const reverted = aFile({ status: 'reverted', blobKey: null, content: null, diff: '' });
  const { routes } = stubPatch(undefined, {
    'POST /api/patches/5/files/revert': detailOf(aPatchSummary({ checking: true }), [
      reverted,
      SNAP,
    ]),
  });
  const user = userEvent.setup();
  renderApp('/pr/wb/12?tab=patch');
  await screen.findByTestId('patch-summary');

  // The patch check finished meanwhile: the PR view and the patch carry the new result.
  const checked = aPatchSummary({ checkVersion: 1, fixed: 1, reproductions: 'fail' });
  routes['/api/prs/wb/12'] = aPrView({ implementer: { patch: checked } });
  routes['/api/patches/5'] = detailOf(checked, [SNAP]);
  await user.click(screen.getByRole('button', { name: t.revertLabel('src/group.ts') }));

  const strip = await screen.findByTestId('new-results');
  expect(screen.getByTestId('patch-summary')).toHaveTextContent('reproductions pass');
  await user.click(within(strip).getByRole('button', { name: t.viewNewResults }));
  await waitFor(() =>
    expect(screen.getByTestId('patch-summary')).toHaveTextContent(
      '1 of 2 fixed · reproductions fail',
    ),
  );
  expect(screen.queryByTestId('new-results')).toBeNull();
});
