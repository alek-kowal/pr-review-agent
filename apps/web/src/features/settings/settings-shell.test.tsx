import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ScrollText, Users } from 'lucide-react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { copy } from '@/copy/index.ts';
import { ApiError } from '@/lib/api.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import type { SettingsPageEntry } from './registry.ts';
import { SaveBar } from './SaveBar.tsx';
import { SettingsLayout } from './SettingsLayout.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { SignedSaveDialog } from './SignedSaveDialog.tsx';
import { useSettingsForm, type SettingsField } from './use-settings-form.ts';

const kasia = { id: 'm-kasia', name: 'Kasia', githubLogin: 'kasia', clickupUserId: null };

type Budget = { budget: string; slots: string };
const SAVED: Budget = { budget: '30', slots: '2' };
const FIELDS: SettingsField<Budget>[] = [
  { key: 'budget', label: 'Daily budget', format: (v) => `$${v}` },
  { key: 'slots', label: 'Agent slots' },
];

/** A Settings page as a feature builds it: fields, SaveBar and the signed save dialog. */
function DemoPage({ onSave }: { onSave: (values: Budget, signedBy: string) => Promise<void> }) {
  const form = useSettingsForm(SAVED, FIELDS);
  const [saving, setSaving] = useState(false);
  return (
    <SettingsPage title="Budget & status" affects="when new rounds wait in the queue.">
      <label>
        Daily budget
        <input value={form.draft.budget} onChange={(e) => form.set('budget', e.target.value)} />
      </label>
      <label>
        Agent slots
        <input value={form.draft.slots} onChange={(e) => form.set('slots', e.target.value)} />
      </label>
      <Link to="/prs">Elsewhere</Link>
      <SaveBar
        count={form.changes.length}
        onDiscard={form.discard}
        onSave={() => setSaving(true)}
      />
      <SignedSaveDialog
        open={saving}
        onOpenChange={setSaving}
        changes={form.changes}
        onConfirm={(signedBy) => onSave(form.draft, signedBy)}
      />
    </SettingsPage>
  );
}

const PAGES: SettingsPageEntry[] = [
  { id: 'audit', to: '/settings/audit', icon: ScrollText },
  { id: 'budget', to: '/settings/budget', icon: Users },
];

function renderSettings(path = '/settings/budget') {
  const onSave = vi.fn(async () => {});
  const root = createRootRoute({ component: Outlet });
  const settings = createRoute({
    getParentRoute: () => root,
    path: 'settings',
    component: () => <SettingsLayout pages={PAGES} />,
  });
  const budget = createRoute({
    getParentRoute: () => settings,
    path: 'budget',
    component: () => <DemoPage onSave={onSave} />,
  });
  const audit = createRoute({
    getParentRoute: () => settings,
    path: 'audit',
    component: () => <p>Audit page</p>,
  });
  const prs = createRoute({
    getParentRoute: () => root,
    path: 'prs',
    component: () => <p>Pull requests page</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([settings.addChildren([budget, audit]), prs]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, onSave };
}

async function editBothFields() {
  const user = userEvent.setup();
  const budget = await screen.findByRole('textbox', { name: 'Daily budget' });
  await user.clear(budget);
  await user.type(budget, '50');
  const slots = screen.getByRole('textbox', { name: 'Agent slots' });
  await user.clear(slots);
  await user.type(slots, '3');
  return user;
}

const saveBar = () => screen.queryByRole('region', { name: copy.settings.saveBar.label });

beforeEach(() => {
  window.localStorage.clear();
  stubFetch({ '/api/team': { members: [kasia] } });
});
afterEach(restoreFetch);

describe('Settings shell', () => {
  test('the sidebar lists registered pages only, in the approved groups', async () => {
    renderSettings();

    const nav = await screen.findByRole('navigation', { name: copy.settings.navLabel });
    expect(
      within(nav)
        .getAllByRole('heading')
        .map((h) => h.textContent),
    ).toEqual([copy.settings.groups.general, copy.settings.groups.system]);
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([copy.settings.pages.budget, copy.settings.pages.audit]);
    expect(within(nav).getByRole('link', { name: copy.settings.pages.budget })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(copy.settings.affects)).toBeInTheDocument();
  });

  test('editing two fields shows "2 unsaved changes", and Discard resets them', async () => {
    renderSettings();
    expect(saveBar()).toBeNull();

    const user = await editBothFields();

    expect(saveBar()).toHaveTextContent('2 unsaved changes');
    await user.click(
      within(saveBar()!).getByRole('button', { name: copy.settings.saveBar.discard }),
    );
    expect(saveBar()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Daily budget' })).toHaveValue('30');
    expect(screen.getByRole('textbox', { name: 'Agent slots' })).toHaveValue('2');
  });

  test('Save opens the dialog with two before/after rows and blocks confirm without a signature', async () => {
    const { onSave } = renderSettings();
    const user = await editBothFields();

    await user.click(within(saveBar()!).getByRole('button', { name: copy.settings.saveBar.save }));

    const dialog = await screen.findByRole('alertdialog');
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(
      rows.map((row) =>
        within(row)
          .getAllByRole('cell')
          .map((c) => c.textContent),
      ),
    ).toEqual([
      ['$30', '$50'],
      ['2', '3'],
    ]);
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Daily budget',
      'Agent slots',
    ]);

    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(copy.signature.required);

    await user.click(within(dialog).getByRole('combobox', { name: copy.signature.label }));
    await user.click(await screen.findByRole('option', { name: /Kasia/ }));
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    expect(onSave).toHaveBeenCalledWith({ budget: '50', slots: '3' }, kasia.id);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  test('a failed save keeps the dialog open with the error', async () => {
    const { onSave } = renderSettings();
    onSave.mockRejectedValueOnce(new ApiError('settings_stale', {}, 409));
    window.localStorage.setItem('pra.lastSigner', kasia.id);
    const user = await editBothFields();

    await user.click(within(saveBar()!).getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Kasia'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.errors.settings_stale!);
    expect(saveBar()).toHaveTextContent('2 unsaved changes');
  });

  test('leaving the page with unsaved changes asks first', async () => {
    const { router } = renderSettings();
    const user = await editBothFields();

    await user.click(screen.getByRole('link', { name: 'Elsewhere' }));
    const ask = await screen.findByRole('alertdialog', { name: copy.settings.leave.title });
    expect(ask).toHaveTextContent(copy.settings.leave.description(2));
    await user.click(within(ask).getByRole('button', { name: copy.settings.leave.stay }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(router.state.location.pathname).toBe('/settings/budget');

    await user.click(screen.getByRole('link', { name: copy.settings.pages.audit }));
    const again = await screen.findByRole('alertdialog', { name: copy.settings.leave.title });
    await user.click(within(again).getByRole('button', { name: copy.settings.leave.leave }));

    expect(await screen.findByText('Audit page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/audit');
  });

  test('leaving without changes does not ask', async () => {
    renderSettings();
    await userEvent.click(await screen.findByRole('link', { name: 'Elsewhere' }));
    expect(await screen.findByText('Pull requests page')).toBeInTheDocument();
  });
});
