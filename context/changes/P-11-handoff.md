# P-11 handoff

- Done (each with `pnpm verify` green, 786 tests; e2e 7/7 after T5 and T6): S-07-T1 `bcbd436`, T2 `3154946`, T3 `c30bf3b`, T4 `5c550e7`, T5 `7b20c3b`, T6 `d6452aa`. Main merged in (`16f1203`, no conflicts). Plan, decisions: `context/changes/P-11-manual-start-chains-sensitive/{plan,change}.md`.
- Next: S-07-T7 (`e2e/chains.spec.ts`), not started, working tree clean. Then S-11-T1 to T4 as in `plan.md`.
- T7 notes:
  - `createGitFixture` (`packages/integrations/src/testing/git.ts`) makes only base plus one feature commit. Add an option for extra commits on `feature` (fix 1 and fix 2) and return their SHAs. Put them in `StackState` (`e2e/support/env.ts`). The mirror fetches all of `origin`.
  - `deliverPullRequest` (`e2e/support/github.ts`) needs a `synchronize` variant with head SHA and `commits` count. The fixture `pull_request.synchronize.json` exists. With no `setComparison`, `FakeGitHubGateway.compareCommits` throws and commits since falls back to the commit-count difference.
  - The expected head is seeded with SQL on `round_chains.expected_head_sha` (S-14 sets it later).
  - `ScriptedReviewer` (`e2e/support/stack.ts`) reads `brief.md`. A fix check has no brief: its cwd holds `findings.json` and `diff.patch`. Answer `{ fixes: [...] }` with every id resolved. For "push during a running round", hold the session for a PR-number range until a flag row appears (poll the DB).
- Code state:
  - Fix check stages are in `apps/worker/src/stages/fix-check.ts`, the adapter in `packages/agents/src/reviewer/fix-check.ts` and the queries in `packages/db/src/queries/fix-checks.ts`.
  - The api write routes are in `apps/api/src/routes/api/rounds/`. The PR view has a `head` section.
  - The web code is in `apps/web/src/features/rounds/` (StartReview, FixStatus).
- S-11 has not started. WB has no sensitive patterns; S-11-T4 needs a seeded repository with patterns matching `db/migrations/0001_edge_labels.sql`.
