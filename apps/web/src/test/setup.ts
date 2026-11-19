import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
});

// jsdom does not implement scrolling; the router's scroll restoration calls it.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });
