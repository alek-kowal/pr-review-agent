/// <reference types="node" />
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { copy } from '@/copy/index.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { restoreFetch, stubFetch } from '@/test/fetchStub.ts';
import { renderApp } from '@/test/renderApp.tsx';
import { THEME_KEY } from './theme.ts';

const html = document.documentElement;
// Read from disk: Vitest does not load CSS, not even with `?raw`.
const css = readFileSync(join(import.meta.dirname, '../../index.css'), 'utf8');

/** Stands in for the system preference. */
function systemPrefers(theme: 'light' | 'dark') {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(prefers-color-scheme: dark)' && theme === 'dark',
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

async function openApp() {
  stubFetch({});
  const app = renderApp('/settings');
  await screen.findByRole('button', {
    name: new RegExp(`^(${copy.theme.toDark}|${copy.theme.toLight})$`),
  });
  return app;
}

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
  window.localStorage.clear();
  html.className = '';
  html.style.colorScheme = '';
});

test('the toggle sets the dark class on html and remembers it on this device', async () => {
  systemPrefers('light');
  const { unmount } = await openApp();
  expect(html).toHaveClass('light');
  expect(html).not.toHaveClass('dark');

  await userEvent.click(screen.getByRole('button', { name: copy.theme.toDark }));
  expect(html).toHaveClass('dark');
  expect(html).not.toHaveClass('light');
  expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');

  // A reload: the stored choice wins over the light system preference.
  unmount();
  html.className = '';
  await openApp();
  await waitFor(() => expect(html).toHaveClass('dark'));
  await userEvent.click(screen.getByRole('button', { name: copy.theme.toLight }));
  expect(html).toHaveClass('light');
  expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
});

test('the system preference applies when nothing is stored', async () => {
  systemPrefers('dark');
  await openApp();
  await waitFor(() => expect(html).toHaveClass('dark'));
  expect(screen.getByRole('button', { name: copy.theme.toLight })).toBeVisible();
});

test('the toggle still works when storage throws', async () => {
  systemPrefers('light');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  await openApp();

  await userEvent.click(screen.getByRole('button', { name: copy.theme.toDark }));
  expect(html).toHaveClass('dark');
  expect(screen.getByRole('button', { name: copy.theme.toLight })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: copy.theme.toLight }));
  expect(html).toHaveClass('light');
});

/** The custom properties declared in each block whose selector is exactly `selector`. */
function tokens(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, head, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head!.replace(/\/\*[\s\S]*?\*\//g, '').trim() !== selector) continue;
    for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(name!, value!.trim());
    }
  }
  return found;
}

test('every light token has a dark value, for the toggle and for the system preference', () => {
  const light = tokens(':root');
  const toggled = tokens(':root.dark');
  const system = tokens(':root:not(.light)');
  expect(light.size).toBeGreaterThan(40);

  const themed = [...light].filter(([, value]) => value.startsWith('#') || value.startsWith('rgb'));
  expect(themed.length).toBeGreaterThan(30);
  for (const [name] of themed) {
    expect(toggled.has(name), `${name} in :root.dark`).toBe(true);
    expect(system.has(name), `${name} in the prefers-color-scheme block`).toBe(true);
  }
  expect(Object.fromEntries(system)).toEqual(Object.fromEntries(toggled));

  // The shadcn variables only point at WB tokens, so they switch with them.
  for (const [name, value] of light) {
    const reference = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    if (reference) expect(light.has(reference), `${name} → ${reference}`).toBe(true);
  }
});
