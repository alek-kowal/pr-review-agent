import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globalSetup: ['@pra/db/testing/global-setup'],
    // Real pg-boss, git and Postgres: several worktrees run their tests at once on one machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
