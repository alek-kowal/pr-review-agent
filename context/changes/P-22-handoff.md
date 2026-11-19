# P-22 handoff

- Done: plan (`P-22-push-autofix-shadow/plan.md`, brief, change.md Decisions) and S-14-T1 (8fafa59).
- Partial: S-14-T2 (00aade6). Core `canPush` + `push-rule.test.ts` pass. Migration
  `0025_patch_push.sql` (patches.pushed_sha/pushed_at/push_refusal); job `patch.push`
  (`sendPushJob`, exclusive per patch); worker `apps/worker/src/run/push.ts` registered in worker.ts.
- S-14-T2 fix needed: `apps/worker/test/push-job.test.ts` fails in `readyPatch()`: the bare clone has
  branch `feature`, which clashes with `feature/edge-labels`. Run `git update-ref -d refs/heads/feature`
  on the bare before creating the PR branch, then make the 4 cases pass, run prettier, record T2
  decisions in change.md (codes lower snake_case; signer field `signedBy`; timeline kinds
  `patch_pushed` / `autofix_pushed` / `patch_push_refused`; no head_changes row, `expectOwnFix`
  on the latest chain), then commit `feat(S-14-T2)`.
- Left: S-14-T3, T4, T5, S-15-T1, T2, T3, T5, S-19-T9. Follow `plan.md` phases 3–10.
- Know: write files only with Write/Edit (no python/sed). Worker tests: no `execa` dep, use
  `node:child_process`. The commit date is `patch.createdAt` (retry gives the same SHA). The bot
  can't sign decisions yet (S-15-T1 makes `decision_batches.signed_by` nullable + `actor`).
  e2e `LEARNING_REPOSITORY` is level 6, so autofix (≥5) may affect its spec.
