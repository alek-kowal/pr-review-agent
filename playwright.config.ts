import { createHash } from 'node:crypto';

import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);
// One port per checkout, so e2e runs from several worktrees never share (or reuse) a dev server.
const port = Number(
  process.env.E2E_PORT ??
    5200 + (createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 700),
);
const webURL = `http://localhost:${port}`;

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
    // group, so Playwright's stop would kill pnpm and leave Vite running.
    command: `node_modules/.bin/vite --port ${port} --strictPort`,
    cwd: 'apps/web',
    url: webURL,
    reuseExistingServer: false,
  },
});
