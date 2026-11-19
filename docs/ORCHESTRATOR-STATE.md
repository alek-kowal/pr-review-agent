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

Wait for the ra-stack watcher. When it is done, exit the session (`herdr agent prompt <name> /exit`) and start `ra-roadmap` in the same pane (w2:pA), with `--disallowedTools AskUserQuestion`. Then:
1. `gh auth switch --user alek-kowal`
2. `gh repo create alek-kowal/pr-review-agent --private --source . --push`
3. Switch gh back to `aleksandrio`

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
- **Parallel tasks** come from the roadmap's parallel marks. Each runs in its own git worktree at `~/Projects/pr-review-agent.worktrees/<task-id>` on branch `task/<task-id>`, in its own Herdr tab in w2, with at most 3 agents at once. The first scaffold task runs alone on `main`, because everything depends on it.
- **Merging is done by the orchestrator:**
  1. In the worktree: `pnpm install`, then the tests, typecheck and lint.
  2. In the main checkout: `git merge --no-ff task/<id>`. On a conflict, a fresh merge session resolves it.
  3. Push `main` and remove the worktree.
- **Review:** one `/10x-impl-review` session per finished slice, not per task. Its findings become follow-up tasks.
- **Progress:** each task's status lives in the roadmap tasks file, under "Task progress" below.

## Task progress

| Task | State | Agent | Branch | Notes |
| --- | --- | --- | --- | --- |
