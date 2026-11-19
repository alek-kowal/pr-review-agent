import { availableParallelism } from 'node:os';

import { defineConfig } from 'vitest/config';

// Locally, several worktrees run `pnpm verify` at once (one per agent). Each run takes a quarter of
// the cores, so four runs share the machine instead of each grabbing all of it and timing out.
// CI runs alone and keeps Vitest's default. Override with VITEST_MAX_WORKERS.
const localWorkers = Number(
  process.env.VITEST_MAX_WORKERS ?? Math.max(2, Math.floor(availableParallelism() / 4)),
);

export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*', 'scripts'],
    ...(process.env.CI ? {} : { maxWorkers: localWorkers }),
  },
});
