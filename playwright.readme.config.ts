import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.ts';

// `pnpm readme:shots`: the README screenshots (docs/assets/readme/) on the same e2e test stack and
// doubles as `pnpm test:e2e`. Its file ends in `.readme.ts`, so `pnpm test:e2e` never runs it, and
// both use the same ports: run one at a time.
export default defineConfig({
  ...base,
  testDir: 'e2e/readme',
  testMatch: '*.readme.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: 'test-results/readme',
  projects: [
    {
      name: 'readme',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
