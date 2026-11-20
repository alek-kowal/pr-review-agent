// S-20-T4: Settings → Repositories and a repository's settings page.
import { DEFAULT_CHANGE_TYPE_RULES, type RepositoryConfig } from '@pra/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type {
  AvailableRepository,
  ConnectedRepository,
  RepositoriesSettingsResponse,
  TeamMember,
} from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { aStatus } from '@/test/fixtures.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.repositories;
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const wbConfig: RepositoryConfig = {
  slug: 'workflowbuilder',
  githubFullName: 'synergycodes/workflowbuilder',
  defaultBranch: 'main',
  defaultLevel: 1,
  fetchCommand: null,
  installCommand: 'pnpm install --offline',
  clickup: {
    workspaceId: '9012',
    spaceId: null,
    followUpListId: null,
    taskIdPattern: 'WB-\\d+',
  },
  sensitivePatterns: [{ pattern: '.github/workflows/**', reason: 'CI and release workflows.' }],
  changeTypeRules: DEFAULT_CHANGE_TYPE_RULES,
  largePrLines: 1000,
};
const wb: ConnectedRepository = {
  id: 1,
  slug: wbConfig.slug,
  githubFullName: wbConfig.githubFullName,
  installationId: 7,
  config: wbConfig,
};
const reachable = (fullName: string): AvailableRepository => ({
  fullName,
  installationId: 7,
  account: fullName.split('/')[0]!,
  defaultBranch: 'develop',
  private: false,
});
const list = (over: Partial<RepositoriesSettingsResponse> = {}): RepositoriesSettingsResponse => ({
  repositories: [wb],
  available: [reachable('acme/second-repo')],
  availableError: null,
  ...over,
});

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

const callsTo = (calls: FetchCall[], method: string, path: string) =>
  calls.filter((call) => call.method === method && call.path === path);

describe('Settings → Repositories', () => {
  test('lists the connected repositories with level, ClickUp and sensitive files', async () => {
    stubFetch({ '/api/settings/repositories': list() });
    renderApp('/settings/repositories');

    const table = await screen.findByRole('table', { name: t.tableLabel });
    const [row] = within(table).getAllByRole('row').slice(1);
    expect(row).toHaveTextContent('synergycodes/workflowbuilder');
    expect(row).toHaveTextContent('1 · Diff only');
    expect(row).toHaveTextContent(`${t.on}1 pattern`);
    const nav = screen.getByRole('navigation', { name: copy.settings.navLabel });
    expect(
      within(nav).getByRole('link', { name: copy.settings.pages.repositories }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('the connect picker lists only unconnected repositories', async () => {
    stubFetch({
      '/api/settings/repositories': list({
        // A list that is out of date still never offers a connected repository.
        available: [reachable('acme/second-repo'), reachable('synergycodes/workflowbuilder')],
      }),
    });
    renderApp('/settings/repositories');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: t.connect.label }));

    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['acme/second-repo']);
  });

  test('without GitHub the list still shows and says why nothing can be connected', async () => {
    stubFetch({
      '/api/settings/repositories': list({
        available: [],
        availableError: { code: 'github_not_configured', params: { missing: ['GITHUB_APP_ID'] } },
      }),
    });
    renderApp('/settings/repositories');

    expect(await screen.findByRole('status')).toHaveTextContent(copy.errors.github_not_configured!);
    expect(screen.queryByRole('combobox', { name: t.connect.label })).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: t.tableLabel })).toBeInTheDocument();
  });

  test('connecting posts every field, signed, and opens the new repository', async () => {
    const second: ConnectedRepository = {
      id: 2,
      slug: 'second-repo',
      githubFullName: 'acme/second-repo',
      installationId: 7,
      config: { ...wbConfig, slug: 'second-repo', githubFullName: 'acme/second-repo' },
    };
    const { calls } = stubFetch({
      '/api/settings/repositories': list(),
      '/api/team': { members: [tomek] },
      'POST /api/settings/repositories': { status: 201, body: { repository: second } },
      '/api/settings/repositories/2': { repository: second },
    });
    const { router } = renderApp('/settings/repositories');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: t.connect.label }));
    await user.click(await screen.findByRole('option', { name: /acme\/second-repo/ }));
    await screen.findByRole('heading', { name: t.connectPage.title('acme/second-repo') });
    expect(screen.getByLabelText(t.fields.defaultBranch)).toHaveValue('develop');
    expect(screen.getByRole('switch', { name: t.fields.clickupEnabled })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: t.connectPage.save }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('row', { name: /Default branch/ })).toHaveTextContent(
      'develop',
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(within(dialog).getByRole('button', { name: t.connectPage.confirm }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/repositories/2'));
    const [post] = callsTo(calls, 'POST', '/api/settings/repositories');
    expect(post?.body).toEqual({
      fullName: 'acme/second-repo',
      signedBy: tomek.id,
      config: {
        defaultBranch: 'develop',
        defaultLevel: null,
        fetchCommand: null,
        installCommand: null,
        clickup: null,
        sensitivePatterns: [],
        changeTypeRules: DEFAULT_CHANGE_TYPE_RULES,
        largePrLines: 1000,
      },
    });
  });
});

// P-28: without the GitHub App there is no list of reachable repositories.
describe('Settings → Repositories without the GitHub App', () => {
  const byName = t.connect.byName;
  const lookupPath = (fullName: string) =>
    `/api/settings/repositories/lookup?fullName=${encodeURIComponent(fullName)}`;

  test('connect by name: the lookup prefills the default branch and the save is signed', async () => {
    const polled: ConnectedRepository = {
      id: 3,
      slug: 'public-repo',
      githubFullName: 'acme/public-repo',
      installationId: null,
      config: { ...wbConfig, slug: 'public-repo', githubFullName: 'acme/public-repo' },
    };
    const { calls } = stubFetch({
      '/api/status': aStatus({ githubMode: 'anonymous' }),
      '/api/settings/repositories': list({
        available: [],
        availableError: { code: 'github_not_configured', params: { missing: ['GITHUB_APP_ID'] } },
      }),
      [lookupPath('acme/public-repo')]: {
        repository: { fullName: 'acme/public-repo', defaultBranch: 'trunk', private: false },
      },
      '/api/team': { members: [tomek] },
      'POST /api/settings/repositories': { status: 201, body: { repository: polled } },
      '/api/settings/repositories/3': { repository: polled },
    });
    const { router } = renderApp('/settings/repositories');
    const user = userEvent.setup();

    const input = await screen.findByRole('textbox', { name: byName.label });
    expect(screen.queryByRole('combobox', { name: t.connect.label })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(byName.hint)).toBeInTheDocument();
    await user.type(input, 'not a name');
    await user.click(screen.getByRole('button', { name: byName.submit }));
    expect(screen.getByRole('alert')).toHaveTextContent(byName.invalid);

    await user.clear(input);
    await user.type(input, 'acme/public-repo');
    await user.click(screen.getByRole('button', { name: byName.submit }));

    await screen.findByRole('heading', { name: t.connectPage.title('acme/public-repo') });
    expect(await screen.findByLabelText(t.fields.defaultBranch)).toHaveValue('trunk');
    await user.click(screen.getByRole('button', { name: t.connectPage.save }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(within(dialog).getByRole('button', { name: t.connectPage.confirm }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/repositories/3'));
    const [post] = callsTo(calls, 'POST', '/api/settings/repositories');
    expect(post?.body).toMatchObject({
      fullName: 'acme/public-repo',
      signedBy: tomek.id,
      config: { defaultBranch: 'trunk' },
    });
    expect(callsTo(calls, 'GET', lookupPath('acme/public-repo'))).toHaveLength(1);
  });

  test.each([
    [404, 'repository_not_reachable', t.connectPage.notFound('acme/missing')],
    [409, 'repository_already_connected', t.connectPage.alreadyConnected('acme/missing')],
  ])('a lookup that answers %i says why', async (status, code, text) => {
    stubFetch({
      '/api/status': aStatus({ githubMode: 'token' }),
      [lookupPath('acme/missing')]: { status, body: { error: { code, params: {} } } },
    });
    renderApp('/settings/repositories/connect?fullName=acme%2Fmissing');

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(screen.queryByRole('button', { name: t.connectPage.save })).not.toBeInTheDocument();
  });
});

describe('a repository page', () => {
  test('a sensitive-file row without a reason blocks the save with a message', async () => {
    const { calls } = stubFetch({ '/api/settings/repositories/1': { repository: wb } });
    renderApp('/settings/repositories/1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: t.sensitiveTable.add }));
    const table = screen.getByRole('table', { name: t.sensitiveTable.label });
    const patterns = within(table).getAllByRole('textbox', { name: t.sensitiveTable.pattern });
    await user.type(patterns.at(-1)!, 'db/migrations/**');
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));

    expect(screen.getByRole('alert')).toHaveTextContent(t.errors.reasonRequired);
    expect(
      within(table).getAllByRole('textbox', { name: t.sensitiveTable.reason }).at(-1),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(callsTo(calls, 'PUT', '/api/settings/repositories/1')).toHaveLength(0);
  });

  test('the confirm table lists every changed field before and after', async () => {
    const { calls } = stubFetch({
      '/api/settings/repositories/1': { repository: wb },
      '/api/team': { members: [tomek] },
      'PUT /api/settings/repositories/1': { repository: wb },
      '/api/settings/repositories': list(),
    });
    renderApp('/settings/repositories/1');
    const user = userEvent.setup();

    const branch = await screen.findByLabelText(t.fields.defaultBranch);
    await user.clear(branch);
    await user.type(branch, 'develop');
    await user.click(screen.getByLabelText(t.fields.defaultLevel));
    await user.click(await screen.findByRole('option', { name: '2 · With context' }));
    await user.click(screen.getByRole('switch', { name: t.fields.clickupEnabled }));
    await user.click(screen.getByRole('button', { name: t.sensitiveTable.add }));
    const table = screen.getByRole('table', { name: t.sensitiveTable.label });
    await user.type(
      within(table).getAllByRole('textbox', { name: t.sensitiveTable.pattern }).at(-1)!,
      'db/migrations/**',
    );
    await user.type(
      within(table).getAllByRole('textbox', { name: t.sensitiveTable.reason }).at(-1)!,
      'Schema changes',
    );
    expect(screen.getByRole('region', { name: copy.settings.saveBar.label })).toHaveTextContent(
      copy.settings.unsaved(4),
    );
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));

    const dialog = await screen.findByRole('alertdialog', {
      name: t.page.saveTitle('synergycodes/workflowbuilder'),
    });
    const rows = within(dialog)
      .getAllByRole('row')
      .slice(1)
      .map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
    expect(rows).toEqual([
      [t.fields.defaultLevel, '1 · Diff only', '2 · With context'],
      [t.fields.defaultBranch, 'main', 'develop'],
      [t.fields.clickupEnabled, t.on, t.off],
      [
        t.fields.sensitivePatterns,
        '.github/workflows/** (CI and release workflows.)',
        '.github/workflows/** (CI and release workflows.); db/migrations/** (Schema changes)',
      ],
    ]);

    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );
    await waitFor(() =>
      expect(callsTo(calls, 'PUT', '/api/settings/repositories/1')).toHaveLength(1),
    );
    const [put] = callsTo(calls, 'PUT', '/api/settings/repositories/1');
    expect(put?.body).toMatchObject({
      before: wbConfig,
      signedBy: tomek.id,
      config: {
        defaultBranch: 'develop',
        defaultLevel: 2,
        clickup: null,
        sensitivePatterns: [
          { pattern: '.github/workflows/**', reason: 'CI and release workflows.' },
          { pattern: 'db/migrations/**', reason: 'Schema changes' },
        ],
      },
    });
  });
});
