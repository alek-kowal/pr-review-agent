import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its own cleanup. Sonner keeps its
// toasts in module state, and a new Toaster shows the ones still there: drop them.
afterEach(() => {
  cleanup();
  toast.dismiss();
});

// jsdom does not implement scrolling; the router's scroll restoration calls it.
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true });

// Radix (Select, Tabs) uses pointer capture, scrollIntoView and ResizeObserver, which jsdom lacks.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Sonner's Toaster follows the system colour scheme through matchMedia, which jsdom lacks.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
