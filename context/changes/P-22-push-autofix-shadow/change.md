---
change_id: P-22
title: Push, autofix and shadow log (S-14-T1–T5, S-15-T1, S-15-T2, S-15-T3, S-15-T5, S-19-T9)
status: planning
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-22 from `context/foundation/work-packages.md`, wave 8. Plan: yes, see `plan.md`
(brief: `plan-brief.md`). One commit per task, in the listed order. Planning ran without
questions (orchestrator rule: decide and record).

## Decisions

### S-14-T1 (push in GitMirror, users in GitHubGateway)

- `pushPatch` lives on `GitMirror` (git work); `GitHubGateway` gains `getUser(login)` and
  `getBotIdentity()` (`GET /app` slug, then `GET /users/<slug>[bot]` for the id, cached). The
  input adds `author`, `date` and `token` to the task's fields; the caller passes the bot.
- The push goes to the remote URL, never to `origin`: the mirror's remote has `mirror = true`,
  which makes git add mirror and force flags to any push to it.
- Author and committer dates come from the caller (the patch), so the same patch always gives
  the same commit. A retried push sends a commit the branch already has and adds nothing.
- A rejected push (`[rejected]`, non-fast-forward or fetch first) is `head_moved`.
- The "argv never contains `--force`" check covers the push command: removing the temporary
  worktree still uses `git worktree remove --force`, which deletes a local folder only.
- `isolatedGitExec` now lets the call's own variables win over the test identity, so a commit
  made as the bot keeps the bot's name.

### S-14-T2 (push rule, push job, hand-off)

- Reason codes are lower snake_case (as P-18): `fork_read_only`, `patch_not_ready {status}`,
  `pr_number_mismatch {number}`, `run_active {kind,status}`, `head_moved {headSha}`,
  `patch_empty`; checked in that order. `fork_read_only` and `run_active` reuse existing codes.
- The job payload's signer field is `signedBy` (as every signed route); `null` means the bot
  (autofix). The job is exclusive per patch (singleton key = patch id).
- Timeline kinds: `patch_pushed` (actor = signer, params `{sha, branch, patchId}`),
  `autofix_pushed` (actor bot) and `patch_push_refused` (params `{reason, patchId}`).
- The job writes no `head_changes` row: the webhook of the pushed commit does. The hand-off is
  `expectOwnFix` on the PR's latest chain, called after the git push and the patch row update.
- A rejected git push (the head moved between the check and the push) re-reads the head and is
  stored as `head_moved` like the check's own refusal.

### S-14-T3 (push endpoint)

- `POST /api/patches/:id/push { typedNumber, signedBy }` → 202 `{ queued: true }`. Checks in
  order: 400 `signature_required`, 404 `patch_not_found`, 400 `signer_unknown`, then `canPush`
  on GitHub's fresh head; every rule refusal is 409 with its own code and params (`head_moved`
  carries `headSha`). The task's upper-case names are the codebase's lower snake_case codes.
- A wrong typed number is 409 `pr_number_mismatch` here (the task says so), while merge keeps
  its 400 `merge_number_mismatch`.
- The endpoint stores nothing on a refusal; only the job records `pushRefusal` and the timeline
  entry. The signer is checked without a lock: the job reads it again when it runs.
- A second click while the job waits is still 202 and adds no job (pg-boss singleton key).

### S-14-T4 (push dialog)

- `PushAction` (`features/patch/`) is the `push` main action; it copies the Merge dialog: typed
  number + `SignatureField`, the form mounted per open. The patch summary reuses the Patch
  tab's line; the file count comes from `GET /api/patches/:id` (reverted files left out).
- Success means "queued" (202): the toast says "Pushing to <branch>" and that the fix check
  starts when GitHub reports the commit. A failed push in the job shows on the timeline.
- `head_moved` and `pr_number_mismatch` have their own sentences; other refusals use the shared
  error copy (new: `pr_number_mismatch`, `patch_not_ready`, `patch_empty`).
