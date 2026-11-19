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

### S-14-T5 (e2e push and fix check)

- Own repository `push-repo` (level 4) with PRs 265–267, each on its own branch
  `edge-labels-<n>`: one shared branch would make the second PR's push a non-fast-forward.
- Its remote is a bare clone of the fixture; the worker's git exec logs every `git push` argv to
  `StackState.gitPushes`, and the spec reads the bare remote for the commit (bot author, parent =
  reviewed head, `Co-authored-by`). The signer's GitHub account is `PUSH_SIGNER` (wb-dev, 4242).
- For this repository only, the GitHub double compares commits with real git in the bare remote
  and reports green CI at any commit (the pushed SHA is not known in advance). A
  `moved-head-<n>` file in the hold folder makes it report another head (variant 1).
- The sandbox double treats a commit carrying the implementer double's `// Fixed:` lines as
  patched, so the fix check's reproduction on the pushed commit no longer reproduces the bug.
- The implementer hold (`hold-implementer`) no longer holds sessions of the push repository: the
  two specs run in parallel and a held session starved implement-patch's Cancel test.

### S-15-T1 (autofix attempts and shadow records)

- The wrapper is `autofixCheck(point, input)`, not `autofixDecision(level, point, input)`:
  `autofixDecision` stays the F-03 start rule it wraps. It returns `{ mode, allowed, reasons,
  reason, findingIds }`; `mode` is `act` from level 5 (level 6 too, the ladder is cumulative),
  `shadow` at 3–4, `off` below. `reason` is the first of `reasons` (the task's `reasonCode`).
- Push adds the fork (first) and the cap to `pushByItself`. `autoPatchesInChain` means the
  automatic patches made before this one at both points, so a third patch with N = 2 is held at
  start and, if it exists anyway, at push.
- An automatic patch is an implementer run autofix started in the chain (a `start`/`started`
  attempt). A run that failed counts too, so a failing fix is not retried without end.
  Implementer runs have no `chain_id`; the attempt carries it.
- One `start` attempt per round (partial unique index), one shadow entry per round start and per
  patch push; a second write adds nothing.
- `recordAutofixAttempt` and `recordShadow` write their Timeline entry (actor bot) in the same
  transaction: `autofix_started`, `autofix_waiting`, `autofix_shadow`. A `pushed` attempt writes
  none, because the push job already writes `autofix_pushed`.
- Shadow `fixed`/`total`: at start the findings it would implement out of those that need work;
  at push the patch's fixed out of its findings.
- Bot decisions: `decision_batches.signed_by` nullable plus `actor` (`member`|`bot`, check:
  member ⇔ signer set). `decideFindings({ signedBy: null })` is the bot; `currentDecisions`
  left-joins the signer and names the bot `pr-review-agent` (`BOT_SIGNATURE`). The api's decision
  `signedBy.id` is nullable; `decisionLabelNames` never treats the bot as the author.
- `shadowByRepository` keeps the latest entry per PR in code (the `Executor` type has no
  `selectDistinctOn`).

### S-15-T2 (autofix and shadow in the worker)

- Two run hooks after `timelineOnRunCompleted` (so "Round finished" and "Patch ready" come
  first): `autofixOnRoundCompleted` (kind `round`) and `autofixOnPatchReady` (kind
  `implementer`). A round decides only while it is still the PR's latest completed round.
- The start input reads what the state table leaves out: the verifier's `remedy` (from
  `finding_verifications`) and the change type (the findings round's `change_type` output, else
  the forced one). Pause and budget are passed as false: the autofix run is created and the S-10
  gates queue it with the pause reason, as the task asks.
- "Nothing to fix" writes no attempt and no shadow entry (there is nothing level 5 would do).
- The bot's Implement decisions cover only the findings nobody decided; already decided Implement
  ones need no batch. They run in `startImplementer`'s `prepare` with the versions the check read,
  so a finding someone decided meanwhile refuses the start (`autofix_findings_changed`) instead of
  overwriting it. `prepare` may now return a reason; `startImplementer` also takes `trigger`
  (`autofix`) and `afterInsert`, which records the `started` attempt in the run's transaction.
- A refused `startImplementer` (for example `run_active`) is a `waiting` start attempt.
- At level 5 only the bot's own patch (a run with a `start` attempt) is pushed by itself; a
  person's patch waits for a person's push. The push check uses the PR row's head; the push job
  checks GitHub's fresh head again.
- The push job, with no signer, records the `pushed` attempt in the transaction that marks the
  patch pushed, and a `waiting` attempt with the refusal when GitHub's state refuses the push.
- Shadow push (levels 3–4, a person's patch) counts no automatic patches: a person made them all.

### P-18 review observations applied here

- O3: `canPush` refuses a closed or merged PR (`pr_closed`, from GitHub's fresh state), after the
  fork check; the endpoint and the job both pass the fresh state.
- O9: a patch whose `baseSha` is not the PR head is `head_moved`, and an active implementer run
  (a revise) is `run_active`; both were already in `canPush`.
- O1: every code `canPush` returns is mapped in `REFUSALS`, so none falls back to `run_active`.
- O6 (sensitive files on a patch) belongs to autofix (S-15-T2: "Autofix waiting: patch touches
  a sensitive file"); a person's signed push does not check it.
