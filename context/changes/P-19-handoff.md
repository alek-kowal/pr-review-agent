# P-19 handoff (usage limit reached during S-12-T2)

Plan: `context/changes/P-19-merge-from-app/plan.md`; decisions: `change.md` in the same folder.

## Done

- Plan, brief and decisions (commit `docs(P-19): plan merge from the app`).
- S-12-T1 GitHub merge and fresh-state reads, committed: `getPullRequestState`,
  `listChangesRequested`, `squashMerge` (Octokit, unconfigured, fake with `addReview`,
  `refuseMerge`, `merges`); `github.merge.test.ts` passes, integrations tests green.

## S-12-T2 in progress (WIP commit, not verified)

Written, not yet typechecked or tested:
- Migration `0014_pr_checks` (`ci_sha`, `ci_checks`, `changes_requested_by`,
  `checks_refreshed_at` on `pull_requests`); loader reads them (CI only for the current head).
- `packages/db/src/queries/merge.ts`: `ciChecksOf`, `storePrCi`, `storeChangesRequested`,
  `lockPullRequest`, `recordPrMergedInApp`, `recordMergeRefused` (exported from queries index).
- `apps/api/src/merge/merge-pr.ts` (service) and `apps/api/src/routes/api/merge/index.ts` (route);
  new `ApiErrorCode`s `merge_number_mismatch`, `head_moved`, `merge_not_ready`, `merge_refused`,
  `github_error`.
- Worker `timelineOnMerged` skips its entry when the PR was already merged in the app.

## Left

1. T2: `pnpm typecheck`; check `IntegrationError` is exported from `@pra/integrations`; check
   whether a web test requires copy for every `ApiErrorCode`; write
   `apps/api/test/routes/merge.test.ts` (cases in the plan, Phase 2); `pnpm verify`; amend the WIP
   into `feat(S-12): merge service and route (T2)`.
2. T3–T5 and S-06-T8 as in the plan (Phases 3–6).
3. `git merge main`, regenerate migration numbering if main added 0014, final `pnpm verify` and
   `pnpm test:e2e`.
