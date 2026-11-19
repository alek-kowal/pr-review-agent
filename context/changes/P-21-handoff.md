# P-21 handoff

- Done: S-23-T1 (core `lesson-candidates.ts`, schema `learning.ts`, migration 0020, queries `packages/db/src/queries/learning.ts`), S-23-T2 (`packages/agents/src/analyst`, `FakeAnalyst`, pipeline lists analyst files).
- Partial T3 (commit `wip(S-23)`): `GitHubGateway.listReviewComments` (+ Octokit, fake `addComment`, test), stage `apps/worker/src/stages/analyse.ts` (registered), `run/learning-hooks.ts` (PR closed/merged hook + run hooks registered), `analyst: Analyst` added to `WorkerDeps`.
- T3 left: wire `analyst: createAnthropicAnalyst()` in `apps/worker/src/main.ts`; add `analyst?: FakeAnalyst` + default in `apps/worker/test/support.ts` and `e2e/support/stack.ts` (worker typecheck fails until then); write `apps/worker/test/analyst-job.test.ts` per the task's Done when (instruction files `prompt-analyst.md`/`analyst-rules.md` must be seeded, else the stage fails `analyst_instructions_missing`).
- Then T4–T7 as in `roadmap-tasks.md` S-23. Design already chosen:
  - T4 `apps/api/src/routes/api/learning/` + `POST /api/prs/:repo/:number/analyst` (repo/number keying like P-19); accept/reject via `applySignedSettingsChange` with a `learning` store whose write calls `acceptLessonCandidate`/`rejectLessonCandidate` (accept also writes the bot's `instructions` log row); 409 `needs_more_prs` from core `canAcceptLesson`; "Try on a PR…" = `lessonDraftOf` then `POST /api/trials`.
  - T6: a `learning` PR view section (`latestAnalysisOf`), a banner line in `BANNER_LINES`, a "Run analyst" header action in `PR_HEADER_ACTIONS`; T5: Settings page `learning` in `registry.ts`, copy in `apps/web/src/copy/learning.ts`.
  - T7: in-app merge does not start the analyst; the e2e must deliver the `closed` webhook after merging. QUESTION_PRS (270–279) makes PR 278's reviewer ask questions.
- Decisions so far are in `context/changes/P-21-learning/change.md`; add T3+ decisions there. `pnpm verify` not run yet on the branch; main not merged yet.
