// S-17-T9: NFR Accessibility and NFR Layout over every route in `a11y-routes.ts`: axe (WCAG 2 A
// and AA) in the light and the dark theme, a visible focus on every Tab stop, and, at 1440×900,
// the screen's work start (`data-work-start`) at or above 400 px.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { A11Y_ROUTES } from './a11y-routes.ts';
import { sql, WB_SLUG } from './support/api.ts';
import { deliverPullRequest } from './support/github.ts';

/** The PR behind `{pr}`; fixed, so a retry or a second worker finds it already reviewed. */
const PR = 253;
const WORK_START_MAX = 400;
/** Enough Tab stops to cross the top bar and well into the page. */
const MAX_TAB_STOPS = 60;

// One worker walks the routes in order, so the PR is delivered once; a failure does not skip
// the routes after it.
test.describe.configure({ mode: 'default' });

const firstId = async (table: string): Promise<number | null> =>
  (await sql<{ id: number }>(`select min(id) as id from ${table}`, []))[0]?.id ?? null;

/** Delivers `PR` once and waits until its first round has finished; returns that round's run. */
async function reviewedRun(deliver: () => Promise<void>): Promise<number> {
  const runOf = () =>
    sql<{ id: number; finished: boolean }>(
      `select r.id, r.finished_at is not null as finished from runs r
         join pull_requests p on p.id = r.pull_request_id
         join repositories g on g.id = p.repository_id
        where g.slug = $1 and p.number = $2 and r.kind = 'round' order by r.id limit 1`,
      [WB_SLUG, PR],
    );
  if ((await runOf()).length === 0) await deliver();
  let run: { id: number; finished: boolean } | undefined;
  await expect
    .poll(async () => (run = (await runOf())[0])?.finished ?? false, { timeout: 60_000 })
    .toBe(true);
  return run!.id;
}

let placeholders: Record<string, number | null> | null = null;

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(90_000);
  const request = await playwright.request.newContext();
  const run = await reviewedRun(() =>
    deliverPullRequest(request, 'ready_for_review', PR, `A11y: edge labels ${PR}`),
  );
  await request.dispose();
  placeholders = {
    pr: PR,
    run,
    repository: await firstId('repositories'),
    instruction: await firstId('instruction_files'),
    trial: await firstId('trials'),
  };
});

/** Fills in the placeholders; null when a record it needs does not exist. */
function resolve(path: string): string | null {
  let missing = false;
  const resolved = path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = placeholders?.[key];
    if (value === null || value === undefined) missing = true;
    return String(value);
  });
  return missing ? null : resolved;
}

/** Opens the route and waits until its work start is on screen and nothing is loading. */
async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('[data-work-start]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^Loading/)).toHaveCount(0, { timeout: 15_000 });
}

async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return result.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
}

// Runs in the page: describes the focused element and whether its focus shows (an outline, or
// a ring drawn with box-shadow), on the element or on its own rendered ::before/::after: a
// stretched link (a board card's title) rings the whole card from its ::after. A string, since
// the e2e TypeScript project has no DOM types.
const FOCUS_PROBE = `(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const shows = (style) =>
    (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
    style.boxShadow !== 'none';
  const pseudo = ['::before', '::after'].some((which) => {
    const style = getComputedStyle(el, which);
    return style.content !== 'none' && style.content !== 'normal' && shows(style);
  });
  const name = el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40);
  return {
    visible: shows(getComputedStyle(el)) || pseudo,
    label: el.tagName.toLowerCase() + ' "' + name + '"',
  };
})()`;

/** Tabs through the page; returns the stops whose focus does not show. */
async function hiddenFocusStops(page: Page): Promise<string[]> {
  const hidden = new Set<string>();
  let first: string | null = null;
  for (let i = 0; i < MAX_TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = (await page.evaluate(FOCUS_PROBE)) as { visible: boolean; label: string } | null;
    // Focus left the page, or came back to the first stop: the walk has gone round.
    if (!stop || stop.label === first) break;
    first ??= stop.label;
    if (!stop.visible) hidden.add(stop.label);
  }
  return [...hidden];
}

for (const route of A11Y_ROUTES) {
  test(`${route.name}: axe in both themes, visible focus, work start near the top`, async ({
    page,
  }) => {
    const path = resolve(route.path);
    test.skip(path === null, `${route.path}: nothing stored on the stack for it yet`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await open(page, path!);

    const workStart = await page.locator('[data-work-start]').first().boundingBox();
    expect(workStart?.y, 'work start top (px)').toBeLessThanOrEqual(WORK_START_MAX);

    expect(await axeViolations(page), 'axe, light theme').toEqual([]);
    expect(await hiddenFocusStops(page), 'Tab stops without a visible focus').toEqual([]);

    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await open(page, path!);
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    expect(await axeViolations(page), 'axe, dark theme').toEqual([]);
  });
}
