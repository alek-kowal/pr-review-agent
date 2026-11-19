import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globalSetup: ['@pra/db/testing/global-setup'],
  },
});
