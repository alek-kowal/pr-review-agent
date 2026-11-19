# Orchestrator log

The orchestrator (the main Claude session in Herdr tab 1) answers the agents' questions on Alek's behalf. Every answer and decision is recorded here so Alek can review or reverse it.

## Decisions from Alek (19 Nov 2026)

| Topic | Decision |
| --- | --- |
| Product framing | It is a **PR review agent**, not a "factory". The target is any project; Workflow Builder is the first repo it serves |
| Name | **PR Review Agent**. Repo `alek-kowal/pr-review-agent`, private. GitHub App/bot `pr-review-agent` |
| Commit identity in this repo | `aleksander.kowal@synergycodes.com` (local git config, company account) |
| Who answers agents' questions | The orchestrator, from `docs/` and the prototype. Alek gets only what is genuinely his to decide |
| Business rule (from Alek's answer to `/10x-prd`) | It supports and never blocks. A person decides when the agent cannot; the goal is for it to work on its own |
| Timeline | Starts now, built during working hours, no fixed deadline yet |
| v1 success | The team makes its decisions in the app |

## Answers to agents' questions

| When | Agent | Question | Answer | Basis |
| --- | --- | --- | --- | --- |
| 19 Nov 02:10 | orchestrator | PRD Open Questions 2, 3, 8–15, 17–19 | Provisional defaults below. They hold for planning and building until Alek changes them | `docs/03`, `04`, `05`, `06`, `01-analysis.md` §3 |

### Provisional answers to the PRD's open questions

These are defaults so the work can go on overnight. Alek reviews them in the morning. Anything marked **Alek** stays open and blocks only what it names.

| # | Default |
| --- | --- |
| 1 | No deadline. Plan by dependency, not by calendar. **Alek** may set dates later |
| 2 | Merge from the app appears only when the checklist is green at the reviewed SHA. There is no override in the app. "Not a blocker" holds because merging in GitHub always stays possible, and metric 5 records it |
| 3 | The app merges and pushes as `pr-review-agent`, never bypassing branch protection. The merge commit body carries `Signed-off-in-app-by: <name>` and the push commit carries `Co-authored-by` the signer's GitHub identity from Team. If branch protection refuses, the app shows GitHub's reason. **Alek** confirms the protection settings per repo |
| 4 | **Alek.** Until then, the agent runtime sits behind an `AgentRunner` interface. Tests use doubles, and real wiring reads `ANTHROPIC_API_KEY` from env/secret store. There is no runtime fake mode: without a key, runs fail with a clear "model access not configured" state |
| 5, 6 | **Alek.** Build and run locally with Docker Compose (Postgres) until a target is chosen. Deployment slices wait |
| 7 | **Alek.** WB first. Repo-specific values live in RepositoryConfig from day one |
| 8 | Link by a ClickUp task ID in the branch name or PR title, with search as a fallback. ClickUp is optional per repo (on for WB) |
| 9 | Yes, it is a real setting: "Agent slots", default 2, in General → Budget & status. Queued shows the reason (slots busy, paused or budget) |
| 10 | Unsigned, as in the approved prototype. They don't push, merge or change settings in force |
| 11 | Nits are optional. They can get opinions and may be decided, but never block and never count as "to decide" |
| 12 | As designed: show the reason and offer "Link a ClickUp task" |
| 13 | Alert comments in ClickUp link to the app, as in the accepted `06-metrics.md`. **Alek** can still say no |
| 14 | v1: per-stage timeout plus Retry from stage, and a "large PR" warning above a per-repo line threshold (RepositoryConfig) suggesting a split. Review per package is a later slice |
| 15 | Start empty. Today's instruction files from `~/Projects/wb-factory/knowledge` (read-only copy) become version 1. No import of runs, lessons or decisions |
| 16 | **Alek.** He switches the old apps off before the pilot. Nothing in the build depends on it |
| 17 | 90 days for full transcripts and raw GitHub events in object storage. DB rows (runs, findings, decisions, costs) are kept with no limit. Configurable |
| 18 | Webhook to board in under 10 s (SSE). A reconcile poll every 10 min as a safety net |
| 19 | "General" is fine |
| 19 Nov 02:40 | orchestrator | What is "one task" given 230 roadmap tasks? | One **roadmap item** (F-01, S-01, and so on) gets one `/10x-new` and one `/10x-plan`. Its tasks T1–Tn become plan phases, and implementation continues across fresh sessions (each under 28%, handed over through HANDOFF.md). A separate 10x cycle for each of the 230 tasks would burn tokens on repeated setup | Alek: "oszczędzaj kontekst" |
| 19 Nov 02:40 | orchestrator | Repo | `alek-kowal/pr-review-agent` created as **private**; history pushed | Alek: repo on alek-kowal |

## 19 Nov, 04:20: packages, wave 1

- P-01 merged (7d581f6). Each test run gets its own database; pg-boss queues are created in `pnpm db:migrate`; the API starts without fastify-cli.
- P-02 hit 30% after T1–T12 and handed off. A fresh session continues T13 (merge checklist) and T14 (PORTING.md).
- Prompt fix: agents read "never touch ~/Projects/wb-factory*" as "never read". Reading the old code is allowed (it is the reference); writing, running or non-GET requests are not. Both package prompts now say so.
- 04:40: P-02b parity pass merged (1779537). It read P's tests and fixed five differences: Verify only for Blocking findings and no questions for "Uses existing parts", field-by-field config fallback, a zero budget does not block, autofix stops trial rounds and patches made on an older commit, and "sensitive" is checked before "one-way". OQ11 (does a nit decided "Implement" block merge?) stays as in P: it blocks. Provisional; Alek can change it.
- Agents cannot see their own context meter, so they don't stop at 25% by themselves. The orchestrator now interrupts them at 26% (`handoff.sh`) and starts a fresh session from the handoff file (`continue-task.sh`).
- 05:40: P-03 merged (bfaa4ea, conflict in `errors.ts` and the lockfile resolved by the orchestrator). Its impl-review P-03r found 10 issues, none critical, all fixed (1dff52e). Report: `context/changes/P-03-integrations-and-deploy/reviews/impl-review.md`. The worst one: missing model prices made the cost guard undercount by up to half. **For Alek:** on the VM, the GitHub App key file must be readable by uid 1000 (the containers do not run as root).
- e2e now uses one dev-server port per checkout (a8e5406). Before that, parallel worktrees could test each other's code on 5173.
- 05:50: P-07 (644d09c), P-05 (a65a490) and P-06 (997c309) merged. Wave 3 done.
  - P-06 and P-07 both added migration 0003. The orchestrator kept main's and regenerated P-06's as 0005; the SQL was identical.
  - After merging main, P-06 failed typecheck: the P-03 review had made `timeoutMs` required in `AgentRunInput`. A short fix session now passes the stage timeout from the frozen level config.
  - Continuation sessions now start with `git merge main`.
- Running: P-08, P-09, P-10 (wave 4) and P-05r (impl-review of the review pipeline).
- 06:10: P-05r impl-review merged (2ad38d7). It fixed 8 of 10 findings. The critical one: a round could stay "running" forever and block the PR. F10 is deferred to P-15/P-16. **For Alek (F6):** until P-16 nothing caps daily agent spend (one session is capped at $10). If you connect a real ANTHROPIC_API_KEY before then, set a monthly limit in the Anthropic console.
- P-06f started: a Docker sandbox test fails under parallel load.
- `supervise.sh` now does handoffs and continuations by itself, and wakes the orchestrator only when a package finishes or blocks.
- 07:00–07:30: **the disk filled up** (117 MB free) and Docker Desktop hung. The disk was nearly full before tonight; most of Docker's 62 GB belongs to other projects.
  - Freed: the pnpm store prune (1.3 GB), the Docker build cache (13.9 GB, cache only), and 10 leftover `pra-sbx-*` sandbox containers. Images of other projects (trainplan, mercatify, carollo and others) were not touched.
  - Docker was force-restarted, because it no longer answered `docker info`. `pra-db-1` was recreated from main: its bind mount pointed at the removed P-01 worktree.
  - `supervise.sh` now stops with DISK_LOW below 4 GB free.
  - Follow-up bug: the sandbox tests leave `pra-sbx-*` containers behind (Created/Exited). Their cleanup must remove them.
  - **For Alek:** about 32 GB of Docker images are reclaimable (`docker system df`), but they belong to your other projects, so that is your call.

## 19 Nov, 08:40–14:25: usage limit, wave 6 merges

- 08:40 every agent hit the subscription usage limit; at 10:20 the auto-resume failed on a DNS outage. The orchestrator re-prompted them at 12:28.
- P-11r (impl-review of chains): 9 of 11 findings fixed, among them a failed sensitive-file scan that still let "Ready to merge" through. Left: foreign key `runs.chain_id` (F10) for the next migration. **For Alek:** after deploying, or after adding a sensitive-file pattern, re-run review on open PRs so they get scanned.
- Merged: P-19, P-16, P-14, P-17, P-15. Several packages generated migrations with the same number; each conflict went to a fresh merge-fix session (keep main's migration, regenerate ours, compare SQL). P-15 needed three rounds. Lesson: merge one package at a time and pause other merge-fixes while one lands.
- P-15 added `run_not_retryable` (409): a failed instruction trial can't be retried.
- P-14: the ClickUp author mention is tested only against the double; the "Notify author" card lives in page memory. **For Alek:** check the mention on a real ClickUp (needs `CLICKUP_API_KEY`).
- P-19 left for Alek: a real merge on WB with the App's permissions (S-12-T6) and a real ClickUp key test (S-06-T9).
- P-23 added an AGENTS.md section "Connect a repository" (about 16 lines, ~250 tokens per agent session in this repo).
- Flaky: `e2e/decide.spec.ts` (two-browser conflict) failed once in CI and once locally; passed on rerun.

## 19 Nov, 14:25–21:50: the rest of the roadmap

- Merged: P-23, P-24, P-20, P-21, P-18, P-18r, P-22, P-22r and a README package (hero, Mermaid flow, 8 screenshots from `pnpm readme:shots`). All 24 packages are on main.
- main went red once (15be12f): P-23 and P-24 merged cleanly but broke typecheck together. P-20 fixed it; `merge-task.sh` now verifies the merge result (lesson 4).
- P-18r: one critical finding fixed: the implementer could write `.git` and run any command on the worker through `git status`, with the worker's secrets. Reproduced, fixed, plus 9 warnings.
- P-22r: 10 findings fixed, none critical (among them: a pause or reached budget did not stop the bot's push; a person's edit or a lowered level did not stop the bot).
- Second usage-limit stop at 15:18; the 17:20 auto-resume again hit a DNS error, re-prompted at 17:38.
- **For Alek, beyond the "Needs Alek" table in `work-packages.md`:**
  - Repositories whose rules require signed commits refuse the bot's push (`push_rejected`): no push or autofix there until the App's commits are signed or the rule lets the App through.
  - Provisional answers to confirm or change: OQ3 (the commit is the bot's, the signer is `Co-authored-by`), OQ11 (a nit decided "Implement" blocks merge).
  - After the first deploy, or after adding a sensitive-file pattern, re-run review on open PRs so they get scanned (P-11r).
  - Anthropic: set a monthly limit in the Console when the real key is connected (P-05r F6).
  - The GitHub App private key file must be readable by uid 1000 on the VM (P-03r).
  - The old apps on :4300/:4400 can be switched off once the real smokes pass.
  - About 24 GB of reclaimable Docker images belong to other projects on this Mac: your call.
- Tech debt left: foreign key `runs.chain_id` (P-11r F10); sandbox tests leave `pra-sbx-*` containers behind (27 removed tonight); flaky `e2e/decide.spec.ts` and API tests near the 5 s limit under load.
