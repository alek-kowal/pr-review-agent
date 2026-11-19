import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globalSetup: ['./src/testing/global-setup.ts'],
  },
});
