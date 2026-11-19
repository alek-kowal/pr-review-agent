# P-14 handoff

- Done and committed: S-08-T1 (answers API), T2 (Questions tab), T3 (answers reach later rounds).
- **Partial: S-08-T4** (commit `wip(S-08) … (T4, partial)`). Done: `queries/reviews.ts` (`saveReview`,
  `opinionsOf`, `reviewsOf`, `getReview`, `lockPullRequestRow`), loader `opinions` + `reviewers`,
  `FindingSchema.opinions`, `POST /api/prs/:repo/:number/reviews`, `test/routes/reviews.test.ts`.
  Left: rerun `pnpm --filter @pra/api test reviews.test.ts` (the concurrent-save case deadlocked;
  the PR row lock in `saveReview` should fix it, not yet verified), add `lockPullRequestRow` at
  the start of `saveAnswers` too, add `opinions` to web `FindingView` + test fixture, commit T4.
- Then T5–T11, as written in `roadmap-tasks.md`. Hooks: T5 the author columns already exist on
  `decision_batches`; T7 register in `RUN_HOOKS.runCompleted`; T8 replace
  `useRefreshFindingsWhenRoundEnds` in `PrPage.tsx`; T9 add questions to `SCRIPTED_REVIEW` in
  `e2e/support/stack.ts`; T10/T11 `reviews.notified_at`, `FakeClickUpGateway.callsOf('createComment')`.
- Migration `0014_questions_and_reviews` holds every S-08 table; its live-notify triggers are
  hand-added at the end. Keep them if you regenerate it after `git merge main`.
- Decisions: `context/changes/P-14-questions-and-signed-reviews/change.md`. Full verify and e2e not run yet.
