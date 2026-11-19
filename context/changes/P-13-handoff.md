# P-13 handoff

Done (one commit each): S-05-T3, S-05-T4, S-19-T1 to T7. `main` was merged in (no conflicts). Decisions are in `context/changes/P-13-verdicts-and-insights/change.md`.
Left: **S-19-T8 (partial, commit f312697)**, then the final commit.
T8 state: `e2e/insights.spec.ts`, `e2e/support/insights-seed.ts` (called once from `stack.ts`; repos `insights-main` 17 PRs, `insights-side` 3, finished 8–12 days ago so the board's 7-day fold never shows them) and `INSIGHTS_MAIN`/`INSIGHTS_SIDE` in `e2e/support/env.ts`. `pnpm test:e2e insights.spec.ts` passed alone.
Still to do for T8:
- run full `pnpm test:e2e` and `pnpm verify` (last green verify: after T7, 800 tests);
- `e2e/a11y-routes.ts` does not exist on main or here; record in change.md that T8 skipped adding Insights routes to it (or add them if main has it by then);
- add a "S-19-T8" Decisions section to change.md (seed in its own repos via `seedPrHistory`, the Trust check uses `/insights/trust` without the repo filter because tab links keep the search);
- final commit: `feat(S-19): end-to-end Insights (T8)`, set change.md `status: done`, and `git rm context/changes/P-13-handoff.md` in that commit.
Notes: write files only with Write/Edit (heredocs get blocked). Run prettier from the repo root (from `apps/web` it ignores `.prettierignore` and reformats `routeTree.gen.ts`).
