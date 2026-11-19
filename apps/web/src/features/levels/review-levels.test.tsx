// S-21-T5: Settings → Review levels.
import {
  AGENT_ROLES,
  DEFAULT_MODELS,
  LEVEL_NUMBERS,
  resolveLevelSettings,
  type LevelNumber,
  type LevelOverrides,
} from '@pra/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { copy } from '@/copy/index.ts';
import { LAST_SIGNER_KEY } from '@/features/signature/last-signer.ts';
import type { LevelsResponse, LevelView, ModelsResponse, TeamMember } from '@/lib/api-types.ts';
import { restoreFetch, stubFetch, type FetchCall } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';

const t = copy.levels;
const tomek: TeamMember = {
  id: 'm-tomek',
  name: 'Tomek',
  githubLogin: 'tomek',
  clickupUserId: null,
};

const levelView = (n: LevelNumber, overrides: LevelOverrides): LevelView => {
  const v = resolveLevelSettings(n, overrides, DEFAULT_MODELS);
  return {
    ...v,
    own: v.own as LevelView['own'],
    models: AGENT_ROLES.map((role) => ({ role, ...v.models[role] })),
  };
};

const levelsResponse = (overrides: LevelOverrides = {}, defaultLevel: LevelNumber = 1) =>
  ({
    defaultLevel,
    levels: LEVEL_NUMBERS.map((n) => levelView(n, overrides)),
  }) satisfies LevelsResponse;

const modelsResponse: ModelsResponse = {
  models: { ...DEFAULT_MODELS },
  defaults: { ...DEFAULT_MODELS },
  overrides: [],
};

const stub = (overrides: LevelOverrides = {}, extra: Record<string, unknown> = {}) =>
  stubFetch({
    '/api/settings/levels': levelsResponse(overrides),
    '/api/settings/models': modelsResponse,
    '/api/team': { members: [tomek] },
    ...extra,
  });

beforeEach(() => window.localStorage.setItem(LAST_SIGNER_KEY, tomek.id));
afterEach(() => {
  restoreFetch();
  window.localStorage.clear();
});

const setting = async (key: string) => {
  await screen.findByRole('region', { name: t.settings.title });
  return document.querySelector<HTMLElement>(`[data-setting="level-${key}"]`)!;
};
const calls = (all: FetchCall[], method: string, path: string) =>
  all.filter((call) => call.method === method && call.path === path);

describe('Settings → Review levels', () => {
  test('the ladder lists levels 1 to 6 and marks the default', async () => {
    stubFetch({ '/api/settings/levels': levelsResponse({}, 3) });
    renderApp('/settings/review-levels');

    const ladder = await screen.findByRole('list', { name: t.ladder.label });
    const links = within(ladder).getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(links[2]).toHaveTextContent(t.page.title(3));
    expect(links[2]).toHaveTextContent(t.defaultBadge);
    expect(links[2]).toHaveTextContent(t.description[3]!);
    expect(links[2]).toHaveAttribute('href', '/settings/review-levels/3');
  });

  test('the default level saves signed with before and after', async () => {
    const { calls: all } = stubFetch({
      '/api/settings/levels': levelsResponse(),
      '/api/team': { members: [tomek] },
      'PUT /api/settings/default-level': { defaultLevel: 2 },
    });
    renderApp('/settings/review-levels');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('combobox', { name: t.defaultLevel.label }));
    await user.click(await screen.findByRole('option', { name: t.levelOption(2) }));
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog', { name: t.defaultLevel.saveTitle });
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    await waitFor(() => expect(calls(all, 'PUT', '/api/settings/default-level')).toHaveLength(1));
    expect(calls(all, 'PUT', '/api/settings/default-level')[0]?.body).toEqual({
      defaultLevel: 2,
      before: { defaultLevel: 1 },
      signedBy: tomek.id,
    });
  });

  test('an inherited value names its source level', async () => {
    stub({ 3: { stageTimeoutMinutes: 45 }, 6: { models: { reviewer: 'claude-opus-5-6' } } });
    renderApp('/settings/review-levels/4');

    const timeout = await setting('stageTimeoutMinutes');
    expect(within(timeout).getByRole('radio', { name: t.inherited })).toBeChecked();
    expect(timeout).toHaveTextContent(`${t.minutes(45)} · ${t.from(3, false)}`);
    expect(await setting('maxFindings')).toHaveTextContent(`7 · ${t.from(2, true)}`);
    expect(await setting('model-verifier')).toHaveTextContent(
      `${DEFAULT_MODELS.verifier} · ${t.fromModels}`,
    );
    // Below level 5 there is no autofix.
    expect(screen.queryByRole('list', { name: t.autofix.title })).not.toBeInTheDocument();
  });

  test('Override and then Inherited returns to the inherited value', async () => {
    const { calls: all } = stub({ 3: { stageTimeoutMinutes: 45 } });
    renderApp('/settings/review-levels/4');
    const user = userEvent.setup();

    const timeout = await setting('stageTimeoutMinutes');
    await user.click(within(timeout).getByRole('radio', { name: t.own }));
    const input = within(timeout).getByRole('textbox', {
      name: t.fields.stageTimeoutMinutes!.label,
    });
    expect(input).toHaveValue('45');
    await user.clear(input);
    await user.type(input, '60');
    expect(screen.getByRole('region', { name: copy.settings.saveBar.label })).toHaveTextContent(
      copy.settings.unsaved(1),
    );

    await user.click(within(timeout).getByRole('radio', { name: t.inherited }));
    expect(within(timeout).queryByRole('textbox')).not.toBeInTheDocument();
    expect(timeout).toHaveTextContent(`${t.minutes(45)} · ${t.from(3, false)}`);
    expect(
      screen.queryByRole('region', { name: copy.settings.saveBar.label }),
    ).not.toBeInTheDocument();
    expect(calls(all, 'PUT', '/api/settings/levels/4')).toHaveLength(0);
  });

  test('an own value saves signed, with inherit for every other value', async () => {
    const { calls: all } = stub(
      { 3: { stageTimeoutMinutes: 45 } },
      { 'PUT /api/settings/levels/4': { level: levelView(4, {}), defaultLevel: 1 } },
    );
    renderApp('/settings/review-levels/4');
    const user = userEvent.setup();

    const timeout = await setting('stageTimeoutMinutes');
    await user.click(within(timeout).getByRole('radio', { name: t.own }));
    const input = within(timeout).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '60');
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    const dialog = await screen.findByRole('alertdialog', { name: t.page.saveTitle(4) });
    expect(
      within(dialog).getByRole('row', { name: new RegExp(t.fields.stageTimeoutMinutes!.label) }),
    ).toHaveTextContent(`${t.fields.stageTimeoutMinutes!.label}${t.inherited}60`);
    await waitFor(() =>
      expect(
        within(dialog).getByRole('combobox', { name: copy.signature.label }),
      ).toHaveTextContent('Tomek'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: copy.settings.saveDialog.confirm }),
    );

    await waitFor(() => expect(calls(all, 'PUT', '/api/settings/levels/4')).toHaveLength(1));
    expect(calls(all, 'PUT', '/api/settings/levels/4')[0]?.body).toEqual({
      values: {
        brief: 'inherit',
        maxFindings: 'inherit',
        maxQuestions: 'inherit',
        stageTimeoutMinutes: 60,
        models: Object.fromEntries(AGENT_ROLES.map((role) => [role, 'inherit'])),
      },
      before: {},
      signedBy: tomek.id,
    });
  });

  test('a value out of range shows the error and blocks the save', async () => {
    stub();
    renderApp('/settings/review-levels/2');
    const user = userEvent.setup();

    const findings = await setting('maxFindings');
    await user.click(within(findings).getByRole('radio', { name: t.own }));
    const input = within(findings).getByRole('textbox');
    await user.clear(input);
    await user.type(input, '8');
    expect(findings).toHaveTextContent(t.invalid.maxFindings!);
    await user.click(screen.getByRole('button', { name: copy.settings.saveBar.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.page.invalidSummary);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  test('level 5 shows the four autofix rules and only N is editable', async () => {
    stub();
    renderApp('/settings/review-levels/5');

    const rules = await screen.findByRole('list', { name: t.autofix.title });
    const items = within(rules).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items.slice(0, 3).map((item) => item.textContent)).toEqual(
      t.autofix.rules.map((rule, i) => `${i + 1}${rule}`),
    );
    expect(within(rules).getAllByRole('textbox')).toHaveLength(1);
    expect(
      within(items[3]!).getByRole('textbox', { name: t.fields.autofixMaxPatches!.label }),
    ).toHaveValue('2');
  });

  test('level 6 shows the inherited N as text', async () => {
    stub({ 5: { autofixMaxPatches: 3 } });
    renderApp('/settings/review-levels/6');
    const rules = await screen.findByRole('list', { name: t.autofix.title });
    expect(within(rules).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(rules).getAllByRole('listitem')[3]).toHaveTextContent(
      `${t.autofix.atMostBefore}3${t.autofix.atMostAfter}`,
    );
  });
});
