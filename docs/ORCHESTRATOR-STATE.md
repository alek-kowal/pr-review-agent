# Orchestrator state: PR Review Agent

This file is the resume point for the orchestrator, the main Claude session in Herdr workspace w2, tab 1, pane w2:p1. After a compaction or in a fresh session, read this file first and continue from **Next step**.

## Mandate from Alek (19 Nov 2026, before he left for the night)

- Answer every agent's questions myself, from `docs/` and the approved prototype. Log each answer in `docs/08-orchestrator-log.md`.
- Order of work:
  1. PRD
  2. tech-stack.md
  3. roadmap with tasks
  4. a private repo `alek-kowal/pr-review-agent` (commit email `aleksander.kowal@synergycodes.com`, set in the local repo config)
  5. `/10x-bootstrapper` (scaffolding and foundations)
  6. the roadmap slices in order
- **Every task runs in a fresh agent session.** No session goes past 30% context: at 28% it writes a handoff and stops. A watcher script checks this: `scratchpad/watch-agent.sh <name> 28 30` (full path: `/private/tmp/claude-501/-Users-alek-Projects/bac86def-abc6-494b-addd-7d17482934ca/scratchpad/watch-agent.sh`).
- The orchestrator itself: at about 27% context, update this file, then compact. Do the compaction by sending `/compact` to pane w2:p1 through Herdr after the turn ends. A running watcher's notification wakes the session afterwards.
- Product: **PR Review Agent**. It is a PR review agent for any project, and Workflow Builder is the first repo it serves. The UI is in English. Write documents in English and talk to Alek in Polish.

## Hard limits (things only Alek may do)

- Don't create any external account, GitHub App, API key, ClickUp setup, cloud resource or anything paid. Slices that need these get built and tested with test doubles. The real wiring is parked for Alek, with exact steps.
- Don't touch the live old apps on :4300 and :4400, or the folders `~/Projects/wb-factory` and `~/Projects/wb-factory-wb`, beyond reading.
- Push only to `alek-kowal/pr-review-agent`. No force-push to `main`.
- Never use a fake runtime mode.
- If the weekly subscription limit runs out, stop cleanly and record where things stand.

## Status

| Step | State | Session / agent | Output |
| --- | --- | --- | --- |
| Analysis | done | factory-arch (closed) | `docs/01-analysis.md` |
| Design and prototype | done, approved by Alek 19 Nov | factory-design (tab w2:t4) | `prototype/`, `docs/03…06` |
| PRD | done 02:05 (88 FRs, 19 open questions; provisional answers in `08-orchestrator-log.md`) | factory-prd (closed) | `context/foundation/source-notes.md`, `prd.md` |
| tech-stack.md | in progress | ra-stack (tab w2:t7 "pr-review-agent: tasks", pane w2:pA) | `context/foundation/tech-stack.md` |
| Roadmap and tasks | todo | new session | `context/foundation/roadmap.md` (+ `roadmap-tasks.md`) |
| Folder rename and repo | local done (folder renamed, symlink `wb-factory-prod` kept, git init with company email, 2 commits); GitHub remote todo after roadmap | orchestrator | `~/Projects/pr-review-agent`, `alek-kowal/pr-review-agent` |
| Bootstrap | todo | new session | scaffold |
| Slices | todo | new sessions per task | – |

## Next step

Execution runs by **work packages** (`context/foundation/work-packages.md`: 24 packages in 8 waves, dependency-driven). Loop:
1. Wait for the watcher.
2. `merge-task.sh <id>` for each finished package (verify, merge, push).
3. `ci-wait.sh`.
4. `ready.sh` lists the packages whose dependencies are merged.
5. `spawn-task.sh <id> prompts/package.txt` for each, then a `watch-many.sh 26 <agents>` in the background.

A package that stops at its context budget leaves `context/changes/<id>-handoff.md`, and a continuation session (`prompts/continue.txt`, adapted) picks up from it.

Done and merged (08:25): F-01, P-01..P-13, plus P-02b (parity), P-03r, P-05r (impl-reviews) and P-06f (stable tests). Running: P-14, P-15, P-16, P-17, P-19 (wave 6/7) and P-11r (impl-review of chains). Next ready: P-23. Planned reviews: P-18, P-22.

Disk: the Mac's disk is nearly full (about 9 GB free). `supervise.sh` stops with DISK_LOW below 4 GB. Then free only regenerable things: `docker builder prune -af`, leftover `pra-sbx-*` containers, `pnpm store prune`. Never touch other projects' Docker images. Agent prompts now say Write/Edit only, because shell heredocs trigger a permission prompt; `supervise.sh` declines those prompts by itself (`decline-shell.sh`). Use `prompts/merge-fix-generic.txt` for merge conflicts.

Preferred loop (06:00): `supervise.sh <agents…>` in the background does handoffs and continuations by itself, and exits only on FINISHED, BLOCKED or GONE. Merge with `merge-when-calm.sh <id>`: it waits for load < 16 and retries once. On a code conflict, `git merge --abort` and start a fresh session in the worktree with `prompts/merge-fix.txt` (it merges main into the branch).

Agents cannot see their own context meter. The watcher fires at 26%. Then:
1. `handoff.sh <agent> <id> [note]` interrupts the agent and asks for `context/changes/<id>-handoff.md`.
2. A `watch-many.sh 40 <agent>` waits for that.
3. `continue-task.sh <id>` starts a fresh session in the same pane (prompt `prompts/package-continue.txt`).

When `merge-task.sh` hits a conflict, the main checkout is left mid-merge. Resolve it, reinstall, run `pnpm verify` (plus e2e), commit "merge: task/<id>", push, remove the worktree and the branch.

## How to start a task session

```
herdr agent start <name> --kind claude --pane w2:pA -- --disallowedTools AskUserQuestion -n <name>
herdr agent prompt <name> "<task: inputs, the decided things, no questions unless blocking (plain text), stop before 28% with HANDOFF, commit, reply in Polish in at most 8 lines>"
watch-agent.sh <name> 28 30   (run in background)
```

The first start in a new folder shows a trust dialog. Answer it with `herdr agent send-keys <name> down enter`.

## Environment notes

- Node 24.21, pnpm 12.6.
- Docker.app is installed, but the daemon may be stopped. `open -a Docker` is allowed if a slice needs Postgres.
- No local Postgres binaries.
- gh accounts: `aleksandrio` (active) and `alek-kowal`. Switch to `alek-kowal` for this repo.

## How tasks are executed (decided 19 Nov, 02:15)

- **One roadmap task means one fresh session**, running `/10x-new`, then `/10x-plan` (the agent approves its own plan), then `/10x-implement`, then tests, then a commit. If the session nears 28%, it writes `context/changes/<id>/HANDOFF.md` and the orchestrator starts a continuation session.
- **Parallel tasks** come from the roadmap's parallel marks. Each runs in its own git worktree at `~/Projects/pr-review-agent.worktrees/<task-id>` on branch `task/<task-id>`, in its own Herdr tab in w2, with up to 6 agents at once. The first scaffold task runs alone on `main`, because everything depends on it.
- **Merging is done by the orchestrator:**
  1. In the worktree: `pnpm install`, then the tests, typecheck and lint.
  2. In the main checkout: `git merge --no-ff task/<id>`. On a conflict, a fresh merge session resolves it.
  3. Push `main` and remove the worktree.
- **Review:** `/10x-impl-review` only after complex tasks (Alek, 19 Nov). Verification is the single parallel script `pnpm verify` plus CI. The orchestrator reads only PASS or FAIL.
- **Progress:** each task's status lives in the roadmap tasks file, under "Task progress" below.

## Orchestrator tools (scratchpad, one call each)

All of them are in `/private/tmp/claude-501/-Users-alek-Projects/bac86def-abc6-494b-addd-7d17482934ca/scratchpad/`:
- `agents.sh`: name, status and ctx for every agent.
- `spawn-task.sh <id> prompts/task.txt [main]`: worktree, tab, fresh agent and prompt.
- `watch-many.sh 28 <names…>`: run in the background. It exits when any agent stops, blocks or reaches 28%.
- `merge-task.sh <id>`: verify, merge `--no-ff`, push, clean up.

## Task progress

| Task | State | Agent | Branch | Notes |
| --- | --- | --- | --- | --- |

## 14:25 status
Merged since 08:40: P-11r, P-19, P-16, P-14, P-17, P-15 (main bc351f1). Running: P-18, P-20, P-21, P-24 (implementing) and P-23 (merge-fix, done implementing). Next: P-22 once P-18 merges; impl-review planned for P-18 and P-22.
Merge loop: `merge-or-fix.sh <id>` (exits the agent, merges when calm; on conflict aborts main and starts a merge-fix agent, prints MERGED/FIXING/FAIL). Run merges one at a time; pause a merge-fix while another package is about to land, to avoid migration-number races.
supervise.sh now re-prompts an agent stopped by "API Error". Flaky: e2e/decide.spec.ts conflict scenario.
