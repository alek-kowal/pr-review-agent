# Orchestrator lessons

Recurring problems seen while running parallel agent sessions on this repo, and what the orchestrator does about them now. Read this together with `docs/ORCHESTRATOR-STATE.md` before coordinating new work. Add a lesson when a problem shows up a second time.

## Merging

1. **Migration number races.** Parallel packages each generate the next free Drizzle migration number (three packages took 0016 on one day). Every merge after the first conflicts, and a merge-fix fixed against an old main conflicts again (P-15 needed three rounds).
   - Merge a package as soon as it finishes, one merge at a time (`merge-or-fix.sh`).
   - While one package is landing, pause other merge-fix sessions (esc, `/exit`, `git merge --abort` in the worktree), then restart them once main has moved.
   - Merge-fix rule: keep main's migrations untouched, regenerate ours with `pnpm db:generate --name <same name>`, compare the SQL, carry over hand-written parts.
2. **Generated files.** `routeTree.gen.ts` is regenerated, never hand-merged. Barrel and index files, copy and `e2e/support`: keep both sides.
3. **Hotspot files** (`apps/api/src/plugins/errors.ts`, `apps/web/src/features/pr/slots.ts`, `e2e/support/stack.ts`, `packages/db/src/queries/index.ts`, `schema/index.ts`) conflict in almost every merge. They are additive, so keeping both sides is the default.
4. **Clean merges can still break main.** P-23 and P-24 merged without a conflict, but together they broke typecheck in `board.ts` (main went red). The verify used to run on the branch, not on the merge result. `merge-task.sh` now merges main into the worktree first, verifies that tree, and only then merges into main; on a conflict main stays untouched.
5. **CI on docs pushes.** A docs push right after a merge cancels that merge's CI run. Check CI on HEAD, not on the merge commit. `gh run list -c` needs the full SHA.

## Agent sessions

5. **Agents cannot see their own context meter.** They never stop at the budget by themselves. `supervise.sh` reads `ctx:` from the pane, asks for a handoff at 26% and continues in a fresh session.
6. **Lost Enter under load.** With load above ~40, a prompt can stay unsent in the input box. `continue-task.sh` and `merge-or-fix.sh` re-send Enter while the agent stays idle.
7. **API errors and network outages** stop an agent in the "done" state, which looks like a finished task. `supervise.sh` checks the last `⏺` line and re-prompts on "API Error". An agent idle with "1 shell still running" is waiting for its own e2e run, not finished; `supervise.sh` keeps watching it. Always read the final summary before merging.
8. **Usage limit.** All agents hit the 5-hour subscription limit at once (08:40), and their auto-resume failed on a DNS outage at reset time. Watch `5h:NN%` in an agent's status line; above ~80%, start no new packages. After a reset, check every agent and re-prompt.
9. **`/exit` with background work** (a scheduled task left by the agent) opens a confirmation dialog. `merge-or-fix.sh` answers it ("Exit and stop tasks").
10. **Shell heredocs and `sed -i`** trigger the "Dangerous rm operation" permission prompt and block an unattended agent. Prompts say: write files only with Write/Edit. `supervise.sh` declines the prompt automatically.
11. **Ambiguous rules get over-applied.** "Never touch wb-factory" was read as "never read". Spell out what is allowed (reading, GET) and what is not (writing, running, non-GET).

## Machine

12. **Load.** Six agents running Vitest and Playwright pushed load to 40–60 and caused 5 s test timeouts. Vitest uses at most a quarter of the cores locally; `merge-when-calm.sh` waits for load below 16 before verifying a merge.
13. **Disk.** Docker filled the disk once (ENOSPC). Keep at least 4 GB free (`supervise.sh` stops with DISK_LOW). Only free regenerable data: `docker builder prune`, leftover `pra-sbx-*` containers, `pnpm store prune`. Never touch other projects' images or volumes.
14. **Docker Compose from a worktree** bind-mounts that worktree. Removing the worktree breaks `pra-db-1`. Run `docker compose up` only from the main checkout.

## Tests in parallel worktrees

15. **Shared ports.** e2e used a fixed Vite port, so one worktree could test another's code. Each checkout now gets its own port from a hash of its path.
16. **Shared test data.** Two specs used the same test repository name or PR numbers and collided in the shared database. Each spec uses its own repository name and PR-number range.
17. **Known flaky tests:** `e2e/decide.spec.ts` (two-browser conflict scenario); API tests near the 5 s limit under heavy load. Re-run once before treating a failure as real.

## Orchestrator itself

18. **Self-compaction.** A `/compact` text longer than ~500 characters arrives as a paste and does not run. Keep it short.
19. **zsh quirks.** `echo ==` fails (`=` expansion), and an unmatched glob is an error. Use `echo "=="` and `setopt null_glob`, or avoid both.
20. **Context.** Read agent results with a `grep '⏺' | tail`, not whole panes. Chain merges in one background command and let notifications wake you, instead of polling.
