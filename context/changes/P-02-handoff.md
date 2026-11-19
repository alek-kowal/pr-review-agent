# P-02 handoff

- **Done (one commit each):** F-03-T1 to F-03-T12. `pnpm --filter @pra/core test`, `typecheck` and lint pass for core; full `pnpm verify` not run yet.
- **Left:** F-03-T13 (merge checklist, `src/checklist.ts`, `src/reasons/checklist.ts`, `test/checklist.test.ts` still empty stubs with `it.todo`) and F-03-T14 (`packages/core/PORTING.md`, 98 rows).
- **Uncommitted:** nothing; working tree is clean.
- **Must know:**
  - `~/Projects/wb-factory` was NOT read (orchestrator ban; classifier blocked it). Ported tests name the P file:line in their title (e.g. `(P review.test.ts:36)`); the rule-to-line mapping is inferred. PORTING.md must say parity with P is unverified.
  - T13: build `checklist(input: PrSnapshot)` on `prState`, `toDecide`, `toFix`, `openQuestions`; item order and failing variants follow `checklist` in `prototype/js/sim.js`; CI uses `PrSnapshot.ci` (ok = ≥1 check, all success/skipped/neutral), `changesRequestedBy`. Reason codes must be unique across families (use a `checklist_*` prefix).
  - T14: P line numbers are all in the T2–T13 task text and T14's list; patch-change has 4 tests without line numbers. Check that each "ported" name appears in `pnpm --filter @pra/core test --reporter=verbose`.
  - Decisions so far are in `context/changes/P-02-domain-core/change.md`; set its `status` to `implemented` when done.
  - Then run `pnpm verify` (no UI touched, so no e2e needed) and commit per task.
