// Light and dark theme (S-17-T7). The default follows the system (`prefers-color-scheme`); a
// choice made with the toggle is remembered on this device in localStorage. Storage can throw
// (private windows, blocked site data), so every read and write is wrapped and the theme still
// works for the visit without it.
import { useEffect, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_KEY = 'pra:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** The theme chosen on this device, or null when none was chosen or storage is unavailable. */
function storedTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
    ? 'dark'
    : 'light';
}

/** Set when storage fails, so the choice still holds until the page reloads. */
let unsaved: Theme | null = null;

/** The theme in use: the choice made on this device, else the system's. */
export function currentTheme(): Theme {
  return storedTheme() ?? unsaved ?? systemTheme();
}

/** Puts the `dark` or `light` class on <html>; the CSS tokens key on them (`index.css`). */
export function applyTheme(theme: Theme = currentTheme()): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
  root.style.colorScheme = theme;
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  // With no choice made, a change of the system theme changes the app's.
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  media?.addEventListener('change', notify);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener('change', notify);
  };
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
    unsaved = null;
  } catch {
    unsaved = theme;
  }
  applyTheme(theme);
  notify();
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** The theme in use; keeps the class on <html> in step with it. */
export function useTheme(): Theme {
  const theme = useSyncExternalStore(subscribe, currentTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return theme;
}
