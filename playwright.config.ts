import { defineConfig, devices } from '@playwright/test';
import { API_PORT, API_URL, WEB_PORT, WEB_URL } from './e2e/support/env.ts';

const isCI = Boolean(process.env.CI);

// E2E through the web dev server against the test stack (e2e/support/stack.ts: api and worker
// on doubles, its own database). Ports come from the checkout path (e2e/support/env.ts).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
  },
  projects: [
    // pause-budget.spec.ts pauses the whole factory: it runs first, alone, and restores the state.
    {
      name: 'pause-budget',
      testMatch: 'pause-budget.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: 'pause-budget.spec.ts',
      dependencies: ['pause-budget'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node e2e/support/stack.ts',
      url: `${API_URL}/health`,
      env: { E2E_PORT: String(WEB_PORT), E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
      stdout: 'pipe',
    },
    {
      // The web `dev` script, minus pnpm: pnpm 12 runs scripts in their own process
      // group, so Playwright's stop would kill pnpm and leave Vite running.
      command: `node_modules/.bin/vite --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      url: WEB_URL,
      env: { API_PROXY_TARGET: API_URL },
      reuseExistingServer: false,
    },
  ],
});
