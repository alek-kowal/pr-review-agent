import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Removes the Docker sandbox tests' containers at the end of every run (and stale ones).
    globalSetup: ['./src/testing/sandbox-global-setup.ts'],
  },
});
