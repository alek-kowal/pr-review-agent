# P-13 handoff

Done (one commit each, tests green): S-05-T3, S-05-T4, S-19-T1, S-19-T2. Decisions so far are in `context/changes/P-13-verdicts-and-insights/change.md`; add new ones there.
Left: **S-19-T3 (partial, commit 41fad4c)**, then T4, T5, T6, T7, T8.
T3 state: `packages/db/src/queries/insights.ts` (`finishedPrHistories`, `spendRows`, `averageRoundCost`) and `apps/api/src/routes/api/insights/index.ts` (`/overview`, `/cost`) are written and typecheck, but nothing has run them yet. Still missing:
- `apps/api/test/routes/insights-overview.routes.test.ts` (own DB through `createTestDatabase`, like `activity.test.ts`; 17 merged PRs in one repository, 3 in another);
- the new URLs added to the `arrayContaining` list in `reads-never-write.test.ts`.
Plan: a reusable `seedPrHistory` helper in `packages/db/src/testing/` (PR, `ready_at`/`merged_at`, runs with one stage and one session each, state rows, head changes; later findings, verdicts and decisions for T4), shared by the API tests and the T8 e2e seed.
"In range" means `coalesce(merged_at, closed_at, updated_at) >= now - range days`. The author filter runs in the API, so `authors` lists every author in the range. Cost covers rounds and implementer runs only; trials and the analyst go into `separate`.
Migration `0011_metric_logs.sql`: if another migration lands first, delete it and run `drizzle-kit generate --name metric_logs` again.
`pnpm verify` and full `test:e2e` were green after S-19-T1 and S-05-T4. Run `pnpm verify` again before the next commit.
The e2e stack seeds `acme/verified-repo` (level 3) and `acme/level-two-repo` (level 2). The T8 Trust ladder will see them, so its expectations must account for them.
