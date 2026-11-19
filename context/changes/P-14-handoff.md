# P-14 handoff

- Done and committed: S-08-T1–T8 (main merged at the session start, no conflicts). Decisions for
  every task are in `context/changes/P-14-questions-and-signed-reviews/change.md`.
- Left: T9 (`e2e/questions-reviews.spec.ts`), T10 (notify author API), T11 (card + e2e), then the
  final commit: full `pnpm verify` + `pnpm test:e2e`, delete this file, set change.md `status`.
- T9 not started (nothing uncommitted). Plan: add questions to the scripted reviewer only for a
  new PR-number range in `e2e/support/env.ts` (e.g. `QUESTION_PRS = { from: 260, to: 269 }`; specs
  use 12, 200–205, 300–349, 350–399 held, 400+ failing), so other specs keep no questions;
  then a second full review via manual start to show carried opinions
  ("from round 1") and the "View new results" strip (`data-testid="new-results"`).
- T10/T11: `reviews.notified_at` exists; `FakeClickUpGateway.callsOf('createComment')`.
- Not run yet: full `pnpm verify` and any e2e. Web unit tests can time out under load when other
  worktrees run (passed alone). T8 now holds results of a round that ends while the page is open;
  other e2e specs may need the reload pattern used in `chains.spec.ts` (checks inside `onPrPage`).
- Migration `0014_questions_and_reviews` holds all S-08 tables; keep its hand-added live-notify
  triggers if regenerated after a merge.
