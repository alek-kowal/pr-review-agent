# P-19 handoff (orchestrator stop after S-12-T3)

Plan: `context/changes/P-19-merge-from-app/plan.md`; decisions: `change.md` in the same folder.

- Done, each committed with `pnpm verify` green: S-12-T1 (gateway merge, PR state, reviews), T2
  (`POST /api/prs/:repo/:number/merge`, migration `0014_pr_checks`), T3 (CI and review webhooks,
  force push leaves Ready to merge).
- Left, in order: S-12-T4 (not started, no partial code), T5 `merge.spec.ts`, S-06-T8
  `clickup-link.spec.ts`, then `git merge main`, final `pnpm verify` and `pnpm test:e2e`.
- T4 notes: `MAIN_ACTIONS` in `apps/web/src/features/pr/slots.ts` needs `merge: MergeAction`;
  `NextStepBanner.test.tsx` "ready" fixture expects no button and must be updated. Copy the dialog
  pattern from `features/sensitive/SensitiveAction.tsx` (AlertDialog from `components/ui`). The
  api's 409 `merge_not_ready` sends `params.items` (failing rows), and 422 `merge_refused` sends
  `params.message`. The success body is `{ sha, mergeSha, by }`. Add copy for the new error codes
  and for the timeline entries `merge_refused` and `pr_merged` (`via: 'app'`).
- T5/S-06-T8 notes: the stack's fake must answer `getPullRequestState` for PRs it only saw as
  webhooks (subclass reading the DB row). Use separate `merge-repo` and `clickup-repo` repos.
- `stale-findings.test.tsx` (web) timed out once under full `verify` load; it passes alone.
