import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
const webURL = 'http://localhost:5173';

// E2E against the web dev server. S-01 adds the api and worker test stack (doubles in e2e/support/).
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? 'github' : 'list',
  use: {
    baseURL: webURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The web `dev` script, minus pnpm: pnpm 12 runs scripts in their own process
    // group, so Playwright's stop would kill pnpm and leave Vite running on 5173.
    command: 'node_modules/.bin/vite',
    cwd: 'apps/web',
    url: webURL,
    reuseExistingServer: !isCI,
  },
});
