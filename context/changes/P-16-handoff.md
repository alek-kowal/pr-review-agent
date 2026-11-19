# P-16 handoff (stopped: context full)

Plan and decisions: `context/changes/P-16-pause-budget-and-queue/` (plan.md, change.md). Main merged (no conflicts; migration 0014 still free).
Done: T1–T5 (`ecd08ad` T3 worker gates, `11bdf12` T4 api, `ad7d169` T5 chip + `/settings/budget`). Verify was green after T5 (web tests can time out under parallel `pnpm verify` load; they pass alone).
Left, partial first:
1. T6 (`3973dbf` wip): done: core `queueCauseOf` (+ test), db pr-state loader reads `run_waits` (running run with a wait = queued), api Activity rows `wait`, web `ResumeAction` (main action `resume` opens the chip via `open-status-chip.ts`), `features/budget/wait-text.ts` (`usePauseNames`, `waitText`) in Activity, banner and board card. Banner test wraps a QueryClient now.
   To do: write `apps/web/src/features/budget/queued-banner.test.tsx` (paused/budget/slots: banner text via `renderApp('/pr/wb/12')` with `aPrView({nextStep: {state:'queued', banner:{code:'state_queued_paused', params:{by:{kind:'member',memberId}, note}}, mainAction: resume}})` + status stub `aStatus({pausedBy})`; Resume… opens group "Factory status"; board card in agents_working; Activity row `wait`). Add `wait: null` to activity test fixtures if needed; check `apps/api/test/routes/activity.test.ts` and `pnpm --filter @pra/db test` (pr-state) still pass. Then tick 6.1, commit `feat(S-10): ... (T6)`.
2. T7: `e2e/pause-budget.spec.ts` in its own Playwright project that the main project depends on (runs first, restores state); `e2e/support/stack.ts` sets agent slots 20. `settings-team.spec.ts` already opens `/settings/team` (Settings now lands on Budget & status).
3. `pnpm verify`, `pnpm test:e2e`; last commit deletes this file; change.md Decisions are up to date through T5 (add any T6/T7 ones).
