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
