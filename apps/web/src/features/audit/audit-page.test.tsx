// S-21-T7: Settings → Audit log.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import type { AuditEntry, AuditResponse } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { auditApiPath, type AuditSearch } from './search.ts';

const t = copy.audit;
const KASIA = '7d3c1c4e-0000-4000-8000-000000000001';

const modelChange: AuditEntry = {
  id: 3,
  at: '2026-11-18T09:00:00.000Z',
  area: 'models',
  entity: 'roles',
  actor: 'member',
  signer: { id: KASIA, name: 'Kasia' },
  before: { reviewer: 'claude-opus-5-5', verifier: 'claude-sonnet-5-5' },
  after: { reviewer: 'claude-opus-5-5', verifier: 'claude-sonnet-5-6' },
  note: null,
};
const botChange: AuditEntry = {
  id: 2,
  at: '2026-11-17T09:00:00.000Z',
  area: 'budget',
  entity: 'monthly',
  actor: 'bot',
  signer: null,
  before: { limitUsd: 100 },
  after: { limitUsd: 120 },
  note: null,
};
const handChange: AuditEntry = {
  id: 1,
  at: '2026-11-16T09:00:00.000Z',
  area: 'team',
  entity: 'm-1',
  actor: 'hand',
  signer: null,
  before: null,
  after: { name: 'Tomek' },
  note: null,
};

const page = (entries: AuditEntry[], nextCursor: string | null = null): AuditResponse => ({
  entries,
  nextCursor,
  areas: ['budget', 'models', 'team'],
  signers: [{ id: KASIA, name: 'Kasia' }],
});

afterEach(restoreFetch);

const table = () => screen.findByRole('table', { name: t.tableLabel });
const bodyRows = async () =>
  within(await table())
    .getAllByRole('row')
    .slice(1);

describe('Settings → Audit log', () => {
  test('lists changes with when, who, area and a summary', async () => {
    stubFetch({ '/api/audit': page([modelChange, botChange, handChange]) });
    renderApp('/settings/audit');

    const rows = await bodyRows();
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Kasia');
    expect(rows[0]).toHaveTextContent(t.areas.models!);
    expect(rows[0]).toHaveTextContent(t.summary.changed(['verifier']));
    expect(rows[1]).toHaveTextContent(t.bot);
    expect(rows[1]).toHaveTextContent(t.summary.changed(['limitUsd']));
    expect(rows[2]).toHaveTextContent(t.hand);
    expect(rows[2]).toHaveTextContent(t.summary.created('m-1'));
  });

  test('expanding a row shows before and after', async () => {
    stubFetch({ '/api/audit': page([modelChange, botChange]) });
    renderApp('/settings/audit');
    const user = userEvent.setup();

    const [first] = await bodyRows();
    const toggle = within(first!).getByRole('button', { name: t.expand });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    const before = within(details).getByText(t.before).closest('figure')!;
    const after = within(details).getByText(t.after).closest('figure')!;
    expect(before).toHaveTextContent('"verifier": "claude-sonnet-5-5"');
    expect(after).toHaveTextContent('"verifier": "claude-sonnet-5-6"');

    await user.click(within(first!).getByRole('button', { name: t.collapse }));
    expect(document.querySelector('[data-details]')).toBeNull();
  });

  test('the filters round-trip through the search params', async () => {
    const start: AuditSearch = {
      q: 'verifier',
      area: 'models',
      who: KASIA,
      from: '2026-11-01',
      to: '2026-11-19',
    };
    const { calls } = stubFetch({
      [auditApiPath(start)]: page([modelChange]),
      [auditApiPath({ ...start, area: 'team' })]: page([]),
      [auditApiPath({ ...start, area: 'team', who: 'bot' })]: page([]),
      [auditApiPath({ ...start, q: 'budget', area: 'team', who: 'bot' })]: page([botChange]),
      '/api/audit': page([modelChange, botChange, handChange]),
    });
    const { router } = renderApp(
      `/settings/audit?q=verifier&area=models&who=${KASIA}&from=2026-11-01&to=2026-11-19`,
    );
    const user = userEvent.setup();
    const filters = await screen.findByRole('search', { name: t.filters.label });

    // The URL fills the filters and the request.
    expect(await bodyRows()).toHaveLength(1);
    expect(within(filters).getByRole('searchbox', { name: t.filters.search })).toHaveValue(
      'verifier',
    );
    expect(within(filters).getByRole('combobox', { name: t.filters.area })).toHaveTextContent(
      t.areas.models!,
    );
    expect(within(filters).getByRole('combobox', { name: t.filters.who })).toHaveTextContent(
      'Kasia',
    );
    expect(within(filters).getByLabelText(t.filters.from)).toHaveValue('2026-11-01');
    expect(within(filters).getByLabelText(t.filters.to)).toHaveValue('2026-11-19');
    const [first] = calls.filter((call) => call.path.startsWith('/api/audit'));
    expect(first?.path).toBe(auditApiPath(start));
    expect(first?.path).toContain('actor=');

    // A changed filter goes back into the URL.
    await user.click(within(filters).getByRole('combobox', { name: t.filters.area }));
    await user.click(await screen.findByRole('option', { name: t.areas.team! }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ area: 'team' }));
    await user.click(within(filters).getByRole('combobox', { name: t.filters.who }));
    await user.click(await screen.findByRole('option', { name: t.bot }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ who: 'bot' }));

    const box = within(filters).getByRole('searchbox', { name: t.filters.search });
    await user.clear(box);
    await user.type(box, 'budget');
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'budget' }));
    await waitFor(async () => expect(await bodyRows()).toHaveLength(1));
    expect((await bodyRows())[0]).toHaveTextContent(t.bot);
    expect(router.state.location.search).toEqual({
      q: 'budget',
      area: 'team',
      who: 'bot',
      from: '2026-11-01',
      to: '2026-11-19',
    });

    // Clear drops every filter.
    await user.click(within(filters).getByRole('button', { name: t.filters.clear }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(within(filters).getByRole('searchbox', { name: t.filters.search })).toHaveValue('');
    expect(await bodyRows()).toHaveLength(3);
  });

  test('Load more appends the next page', async () => {
    stubFetch({
      '/api/audit': page([modelChange], '3'),
      '/api/audit?cursor=3': page([botChange, handChange]),
    });
    renderApp('/settings/audit');
    const user = userEvent.setup();

    expect(await bodyRows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: t.loadMore }));
    await waitFor(async () => expect(await bodyRows()).toHaveLength(3));
    expect(screen.queryByRole('button', { name: t.loadMore })).not.toBeInTheDocument();
  });
});
