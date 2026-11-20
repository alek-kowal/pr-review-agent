# Orchestrator tools

Scripts the orchestrator session (Herdr workspace `w2`, pane `w2:p1`) used to build this repo with
parallel agent sessions. They moved here from a session scratchpad so a fresh session can resume.
Read `docs/ORCHESTRATOR-STATE.md` (where we are), `docs/JOURNAL.md` (what happened) and
`docs/orchestrator-lessons.md` (what to avoid) first.

Requirements: zsh, `herdr`, `jq`, `gh` (logged in as `alek-kowal`), run from inside Herdr. The
Herdr workspace `w2` is hard-coded in `agents.sh`, `spawn-task.sh`, `merge-task.sh`,
`merge-or-fix.sh` and `self-compact.sh`; change it there if the workspace differs.

| Script                                | What it does                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `spawn-task.sh <id> <prompt-file>`    | Worktree `../pr-review-agent.worktrees/<id>` on `task/<id>`, a Herdr tab, agent `t-<id>`, sends the prompt (`{{ID}}` replaced). |
| `supervise.sh <agents…>`              | Run in the background. Handoff at 26% context, fresh continuation, re-prompt after API errors, exits on FINISHED/BLOCKED/GONE.  |
| `merge-or-fix.sh <id>`                | Exits the agent, merges main into the worktree, verifies, merges into main and pushes; on conflict starts a merge-fix agent.    |
| `merge-task.sh`, `merge-when-calm.sh` | The merge itself, and the wait for low load before it.                                                                          |
| `ready.sh`                            | Packages whose dependencies (`packages.tsv`) are merged and that have no worktree yet.                                          |
| `ci-wait.sh [sha]`                    | Waits for GitHub Actions on a commit and prints its conclusion.                                                                 |
| `agents.sh`                           | Name, pane, status and context of every agent in `w2`.                                                                          |
| `handoff.sh`, `continue-task.sh`      | Used by `supervise.sh`: ask for a handoff, then start a fresh session on the same worktree.                                     |
| `decline-shell.sh`                    | Declines a blocked "dangerous rm" shell prompt and tells the agent to use Write/Edit.                                           |
| `self-compact.sh`                     | Sends a short `/compact` to the orchestrator pane once it is idle.                                                              |
| `watch-agent.sh`, `watch-many.sh`     | Older watchers, replaced by `supervise.sh`.                                                                                     |

`prompts/` holds the prompt of every package and fix session (`package.txt` is the template for
roadmap packages, `merge-fix-generic.txt` for merge conflicts). `state/` and `supervise.log` are
local and ignored by git.

Deploying to the Mikrus VPS is not here: see `deploy/mikrus/` and `docs/deploy-mikrus.md`.
