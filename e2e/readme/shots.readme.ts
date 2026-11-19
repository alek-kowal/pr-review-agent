// The README screenshots (docs/assets/readme/), taken by `pnpm readme:shots` on the e2e test stack
// and its doubles (e2e/support/stack.ts). Only `README_REPOSITORY` and PR numbers in `README_PRS`
// are used, so the board shows the five PRs below plus nothing from other specs. Not a test: it
// only fails when the app never reaches the state a screenshot needs.
import { rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { bannerTitle, decide, onPrPage, teamMember } from '../support/api.ts';
import { README_PRS, README_REPOSITORY } from '../support/env.ts';
import { deliverCheckSuite, deliverPullRequest, stackState } from '../support/github.ts';

const OUT_DIR = fileURLToPath(new URL('../../docs/assets/readme/', import.meta.url));
const { slug } = README_REPOSITORY;
const THEMES = ['light', 'dark'] as const;

/** The board's PRs: one per lane, plus a second Action needed card. */
const PRS = {
  decide: { number: README_PRS.from, title: 'Rename edge labels inline', author: 'kasia-dev' },
  ready: {
    number: README_PRS.from + 1,
    title: 'Keep edge labels in the undo history',
    author: 'tomek-dev',
  },
  working: {
    number: README_PRS.from + 2,
    title: 'Export edge helpers from the SDK',
    author: 'ola-dev',
  },
  implement: {
    number: README_PRS.from + 3,
    title: 'Fall back to the edge id for empty labels',
    author: 'tomek-dev',
  },
  draft: { number: README_PRS.from + 4, title: 'Group edges by type', author: 'ola-dev' },
} as const;

/** Findings the level-3 round leaves to decide (the Refuted one and the Nit need nobody). */
const TO_DECIDE = ['Empty label hides the edge', 'SDK entry exports an internal type'];

const holdFile = (number: number) => path.join(stackState().holdDir, `hold-${number}`);

/** Level-3 rounds of several PRs at once take longer than `onPrPage`'s minute. */
async function roundCompleted(page: Page, number: number): Promise<void> {
  await expect(async () => {
    await page.goto(`/pr/${slug}/${number}`);
    await expect(page.getByTestId('pr-meta')).toContainText('Round 1 completed', {
      timeout: 3_000,
    });
  }).toPass({ timeout: 180_000 });
}

async function deliver(
  request: APIRequestContext,
  pr: (typeof PRS)[keyof typeof PRS],
  fixture: 'ready_for_review' | 'opened-draft' = 'ready_for_review',
): Promise<void> {
  await deliverPullRequest(
    request,
    fixture,
    pr.number,
    pr.title,
    README_REPOSITORY,
    undefined,
    undefined,
    pr.author,
  );
}

/** Five PRs across the lanes: decided, ready to merge, held mid-review and a draft. */
async function setUpBoard(page: Page, request: APIRequestContext): Promise<void> {
  await teamMember(request, 'Kasia', 'kasia-dev');
  await teamMember(request, 'Tomek', 'tomek-dev');
  await teamMember(request, 'Ola', 'ola-dev');
  for (const pr of [PRS.decide, PRS.ready, PRS.implement]) await deliver(request, pr);
  await deliver(request, PRS.draft, 'opened-draft');
  for (const pr of [PRS.decide, PRS.ready, PRS.implement]) await roundCompleted(page, pr.number);
  // Held until the end, so the PR stays in Agents working while the screenshots are taken.
  await writeFile(holdFile(PRS.working.number), '');
  await deliver(request, PRS.working);
  await decide(request, PRS.ready.number, TO_DECIDE, 'reject', slug);
  await decide(request, PRS.implement.number, TO_DECIDE, 'implement', slug);
  await deliverCheckSuite(request, README_REPOSITORY, stackState().headSha);
  await onPrPage(
    page,
    PRS.ready.number,
    async () => {
      await expect(bannerTitle(page)).toHaveText(/^Ready to merge at /, { timeout: 3_000 });
      await expect(page.getByTestId('checklist')).toContainText('Checklist green', {
        timeout: 3_000,
      });
    },
    slug,
  );
}

/** A screenshot of the top `height` pixels of the 1440-wide viewport (cut below the content). */
async function shot(page: Page, name: string, height = 900): Promise<void> {
  // Let fonts, live updates and transitions settle (the e2e tsconfig has no DOM types).
  await page.evaluate('document.fonts.ready');
  await page.waitForTimeout(600);
  await page.screenshot({
    path: path.join(OUT_DIR, `${name}.png`),
    clip: { x: 0, y: 0, width: 1440, height },
    animations: 'disabled',
    caret: 'hide',
  });
}

async function board(page: Page, theme: string): Promise<void> {
  await expect(async () => {
    await page.goto('/prs');
    for (const pr of Object.values(PRS)) {
      await expect(page.locator('[data-lane]').getByRole('link', { name: pr.title })).toBeVisible({
        timeout: 3_000,
      });
    }
  }).toPass({ timeout: 60_000 });
  await shot(page, `board-${theme}`, 320);
}

async function findings(page: Page, theme: string): Promise<void> {
  await page.goto(`/pr/${slug}/${PRS.decide.number}?tab=findings`);
  const finding = page.getByRole('article', { name: 'Blocking: Empty label hides the edge' });
  await finding.getByRole('button', { expanded: false }).click();
  await finding.getByText('Technical details').click();
  await expect(finding.getByText('exit 0: reproduced')).toBeVisible();
  await shot(page, `pr-findings-${theme}`);
}

async function reviewLevels(page: Page, theme: string): Promise<void> {
  await page.goto('/settings/review-levels');
  await expect(page.getByRole('list', { name: 'Review levels 1 to 6' })).toBeVisible();
  await shot(page, `settings-levels-${theme}`, 770);
}

async function insights(page: Page, theme: string): Promise<void> {
  await page.goto('/insights');
  await expect(page.getByRole('list', { name: 'Pilot metrics' })).toBeVisible();
  await shot(page, `insights-${theme}`, 690);
}

test('README screenshots', async ({ page, request }) => {
  test.setTimeout(240_000);
  await setUpBoard(page, request);
  try {
    for (const theme of THEMES) {
      // The app follows the system theme until someone picks one with the toggle.
      await page.emulateMedia({ colorScheme: theme });
      await board(page, theme);
      await findings(page, theme);
      await reviewLevels(page, theme);
      await insights(page, theme);
    }
  } finally {
    await rm(holdFile(PRS.working.number), { force: true });
  }
});
