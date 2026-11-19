---
project: PR Review Agent
version: 1
status: draft
created: 2026-11-19
updated: 2026-11-19
prd_version: 1
main_goal: market-feedback
top_blocker: external
---

# Roadmap: PR Review Agent

> Derived from `context/foundation/prd.md` (v1), `context/foundation/tech-stack.md` (incl. "Flags and agent decisions"), the provisional answers in `docs/08-orchestrator-log.md`, and an auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices are listed in dependency order. The "At a glance" table is the index. Every item is broken into agent-sized tasks in [`roadmap-tasks.md`](roadmap-tasks.md) (the roadmap schema has no room for tasks).

## Vision recap

Synergy's team reviews PRs with two prototype apps that duplicate work and cost, and almost nothing they produce turns into a recorded decision (4 decisions in 5 days). PR Review Agent replaces them with one app where agents review, verify and fix, a person steps in only where an agent cannot decide, and every opinion and decision is signed and kept. It supports the team and never blocks it; Workflow Builder (WB) is the first repository, configured like any other.

**Sequencing goal (`market-feedback`):** get the team making real review decisions in the app on real WB PRs as early as possible (PRD primary success criterion), then deepen the review and widen the surface in the order the team will feel it.

**How decisions are made for Alek's blockers (`top_blocker: external`):** model access, the GitHub App, the ClickUp key, and hosting with an access gate are Alek's to set up. Every integration is built behind an interface and tested with test doubles (tests only; there is no runtime fake mode). Each piece of real wiring is its own small task marked **Needs Alek** in `roadmap-tasks.md`, with exact setup steps, so code never waits on credentials.

**Where to invest (derived):** deep in the worker, run state machine and agent runtime (NFRs Durability, Cancel really stops, Cost truth, Budget, Isolation gate trust); faithful but simple in the web app (the prototype and `docs/03-design-decisions.md` are the approved spec, so no new design work); simple in data and infra (local Docker Compose until a hosting target exists).

## North star

**S-02: A team member signs a decision on a finding from a real WB review, seen on the board and the PR page** — the north star is the smallest end-to-end flow whose success proves the product works; here that is "a WB PR becomes ready, round 1 runs with a real reviewer agent, its findings show on the board and the PR page, and a person signs a decision". S-01 builds the first half (ready → round 1 → findings on the PR page) and S-02 closes it. It goes first because the primary success criterion counts exactly this: signed decisions recorded in the app.

## At a glance

| ID   | Change ID                       | Outcome (user can …)                                                                  | Prerequisites | PRD refs                                                   | Status   |
| ---- | ------------------------------- | ------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------- | -------- |
| F-01 | monorepo-foundations            | (foundation) pnpm monorepo in the target layout with lint, tests, CI and AGENTS.md    | —             | NFR Language, NFR Repository-agnostic                      | ready    |
| F-02 | local-data-and-jobs             | (foundation) local Postgres, Drizzle migrations and pg-boss run in api and worker     | F-01          | NFR Durability, NFR Complete logs                          | proposed |
| F-03 | domain-core-acceptance-tests    | (foundation) the plain prototype's domain rules live in packages/core as acceptance tests with reason codes | F-01 | Business Logic, NFR Repository-agnostic       | proposed |
| F-04 | pilot-hosting-and-access-gate   | (foundation) the app runs on a hosted target behind a shared access gate              | F-02          | Access Control, NFR Isolation, NFR Privacy toward public PRs | blocked |
| S-01 | first-review-round              | see round 1 start by itself when a WB PR becomes ready and read its findings on the PR page | F-02, F-03 | US-01, FR-004, FR-014, FR-027, FR-028, FR-031, FR-036, FR-058, FR-088 | proposed |
| S-02 | board-and-signed-decision       | see the PR on the board lane and sign a decision on its findings                      | S-01          | US-03, FR-005, FR-040, FR-057, FR-076, FR-087               | proposed |
| S-03 | live-round-progress             | follow a running round live and open its run detail and timeline                      | S-01          | FR-010, FR-025, FR-033, FR-060, FR-061, FR-063              | proposed |
| S-04 | round-checks-and-change-type    | see a round run Checks in a sandbox and set the change type before review             | S-01, S-03    | FR-028, FR-030                                              | proposed |
| S-05 | verified-findings               | see a verdict with evidence on each finding at level 3 and above                      | S-04          | FR-032                                                      | proposed |
| S-06 | clickup-task-context            | have the PR linked to its ClickUp task and defer findings to ClickUp | S-02       | FR-029, FR-042                                      | proposed |
| S-07 | manual-start-and-chains         | start a review by hand at a chosen level and see chains run up to 3 automatic rounds  | S-02          | US-08, US-11, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-045, FR-059 | proposed |
| S-08 | questions-and-signed-reviews    | answer the reviewer's questions, give a signed review of opinions and notify the author | S-06, S-07  | US-02, FR-034, FR-035, FR-037, FR-038, FR-039, FR-041, FR-043, FR-044 | proposed |
| S-09 | retry-and-cancel                | retry a failed round from the failed stage and cancel a round that should stop        | S-03          | US-09, FR-022, FR-023, FR-024                               | proposed |
| S-10 | pause-budget-and-queue          | pause the agent, set a daily budget and agent slots, and see queued rounds with the reason | S-03     | US-10, FR-021, FR-074                                       | proposed |
| S-11 | sensitive-files-approval        | approve changes to sensitive files before a PR can move on                            | S-02, S-04    | US-04, FR-046                                               | proposed |
| S-12 | merge-from-app                  | merge a PR with a green checklist by typing its number and signing                    | S-02          | US-05, FR-054, FR-055, FR-056                               | proposed |
| S-13 | implementer-patch               | run Implement with agent on decided findings and review, edit or revert its patch     | S-02, S-05    | US-06, FR-047, FR-048, FR-049, FR-050                       | proposed |
| S-14 | push-patch-and-recheck          | push the patch after signing and see the next round check the fix                     | S-07, S-13    | US-06, FR-051                                               | proposed |
| S-15 | level5-autofix                  | see level 5 fix and push by itself only when every condition holds, and see its shadow below level 5 | S-10, S-14 | US-07, FR-052, FR-053                     | proposed |
| S-16 | fork-prs-read-only              | review a fork PR by hand, read-only                                                   | S-04, S-07    | US-17, FR-026                                               | proposed |
| S-17 | board-filters-search-shortcuts  | filter and sort the board, search everything, triage by keyboard and switch theme     | S-02, S-08    | FR-006, FR-007, FR-008, FR-009, FR-011, FR-012, FR-013      | proposed |
| S-18 | activity-and-alerts             | see alerts in Activity, get them as ClickUp comments and dismiss them | S-06, S-09 | US-14, FR-064, FR-065, FR-066, FR-067               | proposed |
| S-19 | pilot-metrics-insights          | read the five pilot metrics, cost, quality and trust ladder in Insights               | S-05, S-15    | US-15, FR-069, FR-070, FR-071, FR-072                       | proposed |
| S-20 | connect-repository-in-settings  | connect and configure a repository through Settings alone and see integration health  | S-01          | US-16, FR-001, FR-002, FR-073, FR-077                       | proposed |
| S-21 | models-levels-and-audit-log     | set models per role, default levels and alert thresholds, and search the audit log    | S-18, S-20    | FR-068, FR-075, FR-078, FR-082                              | proposed |
| S-22 | instructions-and-pipeline       | edit versioned instructions by scope, try a draft on a PR, and view the pipeline      | S-07, S-20    | US-12, FR-003, FR-079, FR-080, FR-081                       | proposed |
| S-23 | learning-from-closed-prs        | accept or reject lesson candidates proposed after a level 6 PR closes                 | S-08, S-22    | US-13, FR-062, FR-083, FR-084, FR-085, FR-086               | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                      | Chain                                                                 | Note                                                                         |
| ------ | -------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A      | Foundations and pilot access | `F-01` → `F-02` / `F-03` (parallel) → `F-04`                         | F-04 waits only on Alek's hosting choice; everything else proceeds locally. |
| B      | Decisions in the app       | `S-01` → `S-02` → `S-07` → `S-08` → `S-11` / `S-12` / `S-17` (parallel) | The north star and what the team needs next to decide in the app (main_goal). |
| C      | Round depth and control    | `S-03` → `S-04` → `S-05` → `S-09` / `S-10` → `S-16` → `S-19` | Makes rounds trustworthy and observable; S-16 joins Stream B at S-07.   |
| D      | Fixing                     | `S-13` → `S-14` → `S-15`                                               | Joins Stream B at S-02/S-07 and Stream C at S-05/S-10.               |
| E      | ClickUp, settings, learning | `S-06` → `S-18`; `S-20` → `S-21` / `S-22` → `S-23`                   | S-06 starts after S-02, S-20 right after S-01; S-23 joins Stream B at S-08. |

## Baseline

What's already in place in the codebase as of `2026-11-19` (probed directly; the repo holds only docs, so no subagents were needed).

- **Frontend:** absent — `prototype/` is a static HTML/JS clickable prototype, the approved UX spec and reference only, not the app.
- **Backend / API:** absent — no `package.json`, no server code.
- **Data:** absent — no schema, migrations or Compose file.
- **Auth:** absent, and stays absent by design (PRD §Access Control: shared access gate outside the app, signatures from Settings → Team).
- **Deploy / infra:** absent — no `.github/workflows`, no Dockerfiles. Hosting target undecided (PRD OQ5/6).
- **Observability:** absent — tech-stack.md decides OpenTelemetry + pino + Sentry.

Reference material outside the repo (read-only): the plain prototype `~/Projects/wb-factory` (domain rules and 98 tests, `docs/01-analysis.md` §2.4) and its instruction files in `~/Projects/wb-factory/knowledge` (version 1 of the instructions, PRD OQ15).

## Foundations

Slice 0. Foundations come first and are kept to what the first vertical slice needs to be plannable and verifiable.

### F-01: Monorepo foundations

- **Outcome:** (foundation) a pnpm monorepo exists in the tech-stack.md target layout from the first commit (no root app moved later), with TypeScript, lint and format, Vitest, a Playwright skeleton, CI on GitHub Actions and AGENTS.md conventions.
- **Change ID:** monorepo-foundations
- **PRD refs:** NFR Language, NFR Repository-agnostic (no per-repo code paths), tech-stack.md flags 1–4
- **Unlocks:** F-02, F-03; the CI verification path every later task's "done when" relies on.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Overrides tech-stack.md flag 1 (root Fastify scaffold then move): scaffolding straight into `apps/api` avoids a churn commit but must keep the official generator's layout.
- **Status:** ready
- **Tasks:** [F-01 in roadmap-tasks.md](roadmap-tasks.md#f-01-monorepo-foundations)

### F-02: Local data and jobs

- **Outcome:** (foundation) Postgres runs in Docker Compose, Drizzle migration files apply from a command (never on start), pg-boss runs in the worker, a local-volume BlobStore keeps raw payloads, and api and worker log with pino.
- **Change ID:** local-data-and-jobs
- **PRD refs:** NFR Durability, NFR Complete logs
- **Unlocks:** S-01 (runs, findings and events need tables and a durable queue).
- **Prerequisites:** F-01
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Only the minimal schema (migration tooling plus a smoke table) lands here; product tables arrive with the slices that use them, or this becomes a layer-completion project.
- **Status:** proposed
- **Tasks:** [F-02 in roadmap-tasks.md](roadmap-tasks.md#f-02-local-data-and-jobs)

### F-03: Domain core acceptance tests

- **Outcome:** (foundation) the domain rules of the plain prototype (`docs/01-analysis.md` §2.4) are pure functions in `packages/core`, ported with their tests as acceptance tests that assert structured reason codes, plus the PR state table from `docs/03-design-decisions.md` and `prototype/js/sim.js`.
- **Change ID:** domain-core-acceptance-tests
- **PRD refs:** Business Logic (Review levels, Rounds and chains, Verification and change type, PR states, Autofix conditions, Learning), NFR Repository-agnostic
- **Unlocks:** S-01 and S-02 (lane, banner and round rules); S-05, S-07, S-12, S-15, S-23 reuse the same rules.
- **Prerequisites:** F-01
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Porting is pure logic with no I/O, so it parallelises cleanly; the risk is porting P's Polish strings or I/O, which the reason-code rule prevents.
- **Status:** proposed
- **Tasks:** [F-03 in roadmap-tasks.md](roadmap-tasks.md#f-03-domain-core-acceptance-tests)

### F-04: Pilot hosting and access gate

- **Outcome:** (foundation) api, worker and web run as Docker images on the chosen host with managed Postgres, S3-compatible storage, injected secrets, Sentry, and a shared access gate; state-changing endpoints require a custom header and an allowed `Origin`.
- **Change ID:** pilot-hosting-and-access-gate
- **PRD refs:** Access Control, NFR Isolation, NFR Privacy toward public PRs, NFR Accountability
- **Unlocks:** the pilot itself: the team using S-02 onwards on real WB PRs (primary success criterion); tech-stack.md flag 7 (CSRF).
- **Prerequisites:** F-02
- **Parallel with:** F-03, S-01 and every slice after it
- **Blockers:** Hosting target, access gate type and secret store (PRD OQ5, OQ6) — Alek.
- **Unknowns:**
  - Which host, gate and secret store? — Owner: Alek. Block: yes.
- **Risk:** Isolation (rootless Docker, gVisor) is proven only on a Linux host (tech-stack.md flag 6), so the S-04 sandbox is re-verified on the hosted Linux host once this lands (task S-04-T9).
- **Status:** blocked
- **Tasks:** [F-04 in roadmap-tasks.md](roadmap-tasks.md#f-04-pilot-hosting-and-access-gate)

## Slices

### S-01: First review round

- **Outcome:** user can see round 1 start by itself when a WB PR becomes ready for review, and read its findings (severity, file, line, evidence) on the PR page; the bot posts "Ready for team member review (round 1)" and the full agent session and its real cost are kept.
- **Change ID:** first-review-round
- **PRD refs:** US-01, FR-004, FR-014, FR-027, FR-028, FR-031, FR-036, FR-058, FR-088
- **Prerequisites:** F-02, F-03; WB RepositoryConfig seeded by a seed command (the Settings UI for repositories comes later).
- **Parallel with:** F-04
- **Blockers:** GitHub App `pr-review-agent` created and installed on WB; `ANTHROPIC_API_KEY` available (PRD OQ4) — Alek. Code and tests proceed with test doubles; only the real-wiring tasks wait.
- **Unknowns:**
  - Model billing and key owner (OQ4). — Owner: Alek. Block: no (builds behind `AgentRunner`).
- **Risk:** Runs the Review stage only, with WB seeded at level 1: the Task stage arrives with ClickUp in S-06, Checks and Change type in S-04, verification in S-05; a stage with no executor yet fails with a clear reason code. The first findings are unverified, as at level 1–2 today.
- **Status:** proposed
- **Tasks:** [S-01 in roadmap-tasks.md](roadmap-tasks.md#s-01-first-review-round)

### S-02: Board and signed decision (north star)

- **Outcome:** user can see the PR in the right board lane with its Next step banner, add themselves to Team, and decide one or many findings (Implement, Reject with reason, Defer) with one signature; the lane and banner update.
- **Change ID:** board-and-signed-decision
- **PRD refs:** US-03, FR-005, FR-040, FR-057, FR-076, FR-087
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Lane and banner come from the F-03 state table, not ad hoc UI logic, so later slices only add states; NFR Concurrent edits must hold from the first decision.
- **Status:** proposed
- **Tasks:** [S-02 in roadmap-tasks.md](roadmap-tasks.md#s-02-board-and-signed-decision)

### S-03: Live round progress

- **Outcome:** user can watch a running round update without reload (stage, cost so far) on the PR page and in Activity, see the status chip on every page, the stage stepper and round labels, and open Run detail and the PR Timeline; a reconcile poll every 10 minutes corrects missed webhooks and imports PRs already open when a repository is connected, without starting reviews.
- **Change ID:** live-round-progress
- **PRD refs:** FR-010, FR-025, FR-033, FR-060, FR-061, FR-063, NFR Live view, NFR Freshness, NFR Reads never write
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-06, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** SSE fed by Postgres LISTEN/NOTIFY is the first realtime path; the webhook-to-board target (10 s, OQ18 provisional) is verified here.
- **Status:** proposed
- **Tasks:** [S-03 in roadmap-tasks.md](roadmap-tasks.md#s-03-live-round-progress)

### S-04: Round checks and change type

- **Outcome:** user can see a round run its Checks stage (CI status and install in an isolated sandbox) and set the change type (Uses existing parts, Changes behaviour, One-way door) from path and size rules plus the judge, before the review.
- **Change ID:** round-checks-and-change-type
- **PRD refs:** FR-028, FR-030, NFR Isolation
- **Prerequisites:** S-01, S-03 (the Checks UI extends S-03's stepper and Run detail; its backend tasks can start right after S-01)
- **Parallel with:** S-02, S-06, S-20
- **Blockers:** —
- **Unknowns:**
  - Rootless Docker/gVisor is unavailable on macOS; local runs prove `--network none` only. — Owner: team. Block: no (re-verified on the hosted Linux host in task S-04-T9, after F-04).
- **Risk:** The sandbox is the riskiest infrastructure in the product; it lands before any repro script (S-05) or implementer (S-13) needs it.
- **Status:** proposed
- **Tasks:** [S-04 in roadmap-tasks.md](roadmap-tasks.md#s-04-round-checks-and-change-type)

### S-05: Verified findings

- **Outcome:** user can see each finding at level 3 and above with a verdict (Confirmed, Refuted, Not proven) and its evidence: verbatim quotes checked against the file and a repro script result run in the sandbox.
- **Change ID:** verified-findings
- **PRD refs:** FR-032
- **Prerequisites:** S-04
- **Parallel with:** S-06, S-07, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The verifier must never see the proposed fix and the script result beats the agent's verdict (F-03 rules); getting this wrong poisons the Quality metric in S-19.
- **Status:** proposed
- **Tasks:** [S-05 in roadmap-tasks.md](roadmap-tasks.md#s-05-verified-findings)

### S-06: ClickUp task context

- **Outcome:** user can see the PR linked to its ClickUp task (task ID in branch or title, search as fallback, OQ8), the reviewer gets the task as context, and findings deferred to ClickUp get follow-up tasks.
- **Change ID:** clickup-task-context
- **PRD refs:** FR-029, FR-042
- **Prerequisites:** S-02 (FR-042 acts on S-02's Defer decisions)
- **Parallel with:** S-03, S-04, S-05, S-07, S-20
- **Blockers:** `CLICKUP_API_KEY` and the WB workspace/list IDs — Alek.
- **Unknowns:** —
- **Risk:** ClickUp is optional per repository; a repo without it must still review, so every ClickUp call sits behind the integration interface with a "not linked" state.
- **Status:** proposed
- **Tasks:** [S-06 in roadmap-tasks.md](roadmap-tasks.md#s-06-clickup-task-context)

### S-07: Manual start and chains

- **Outcome:** user can start a review by hand on any open PR at a chosen level, see later rounds start automatically only on the exact expected head, see "N new commits since last review", see a chain stop after 3 rounds, and see a push during a running round change nothing.
- **Change ID:** manual-start-and-chains
- **PRD refs:** US-08, US-11, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-045, FR-059
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** "A push never starts a review" (`docs/05-review-triggers.md`) is the rule most likely to regress; F-03's round tests guard it.
- **Status:** proposed
- **Tasks:** [S-07 in roadmap-tasks.md](roadmap-tasks.md#s-07-manual-start-and-chains)

### S-08: Questions and signed reviews

- **Outcome:** user can answer the reviewer's questions (pick or write), see answers reach later rounds, give signed opinions on findings, save several opinions as one signed review and notify the author with a ClickUp comment (or "Link a ClickUp task" when unlinked), see who usually decides a finding, and keep opinions on matching findings in the next round.
- **Change ID:** questions-and-signed-reviews
- **PRD refs:** US-02, FR-034, FR-035, FR-037, FR-038, FR-039, FR-041, FR-043, FR-044
- **Prerequisites:** S-06, S-07
- **Parallel with:** S-09, S-10, S-11, S-12, S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Opinions carried over across rounds need a stable finding match (file plus content); a weak match silently loses signed opinions.
- **Status:** proposed
- **Tasks:** [S-08 in roadmap-tasks.md](roadmap-tasks.md#s-08-questions-and-signed-reviews)

### S-09: Retry and cancel

- **Outcome:** user can retry a failed round from the failed stage (reusing earlier stage results), cancel a queued or running round or implementer, and see the bot cancel a run when the PR closes; a restart loses nothing.
- **Change ID:** retry-and-cancel
- **PRD refs:** US-09, FR-022, FR-023, FR-024, NFR Durability, NFR Cancel really stops, NFR Cost truth
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-07, S-08, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Cancel must stop spend at once; partial sessions still record real cost up to where they stopped.
- **Status:** proposed
- **Tasks:** [S-09 in roadmap-tasks.md](roadmap-tasks.md#s-09-retry-and-cancel)

### S-10: Pause, budget and queue

- **Outcome:** user can pause PR Review Agent with a reason and resume it, set the daily budget and agent slots (default 2, OQ9), and see rounds wait as Queued with the reason; no session starts over budget.
- **Change ID:** pause-budget-and-queue
- **PRD refs:** US-10, FR-021, FR-074, NFR Budget
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Budget is enforced at session start in the worker, not in the UI, or a burst of webhooks overspends.
- **Status:** proposed
- **Tasks:** [S-10 in roadmap-tasks.md](roadmap-tasks.md#s-10-pause-budget-and-queue)

### S-11: Sensitive files approval

- **Outcome:** user can see which changed files are sensitive (one-way paths) and approve them (unsigned, recorded as "Approved by hand"), which the PR's state and checklist respect.
- **Change ID:** sensitive-files-approval
- **PRD refs:** US-04, FR-046
- **Prerequisites:** S-02, S-04
- **Parallel with:** S-08, S-12, S-13, S-17
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small, but it gates merge readiness, so it lands before or with S-12's checklist.
- **Status:** proposed
- **Tasks:** [S-11 in roadmap-tasks.md](roadmap-tasks.md#s-11-sensitive-files-approval)

### S-12: Merge from the app

- **Outcome:** user can see the merge checklist (failing rows only, or all green), merge a green PR by typing its number and signing (squash pinned to the reviewed SHA, re-checked against fresh GitHub state), and see Ready to merge disappear when the head moves.
- **Change ID:** merge-from-app
- **PRD refs:** US-05, FR-054, FR-055, FR-056
- **Prerequisites:** S-02
- **Parallel with:** S-08, S-11, S-13, S-17
- **Blockers:** —
- **Unknowns:**
  - WB branch protection settings (OQ3). — Owner: Alek. Block: no (the app shows GitHub's refusal reason).
- **Risk:** The first GitHub write beyond one comment; merge goes out as `pr-review-agent` with the `Signed-off-in-app-by` trailer and never bypasses protection.
- **Status:** proposed
- **Tasks:** [S-12 in roadmap-tasks.md](roadmap-tasks.md#s-12-merge-from-app)

### S-13: Implementer patch

- **Outcome:** user can run Implement with agent (signed) on findings decided as Implement at level 4 and above, see it disabled with the reason below level 4, see the finished patch with fixed-finding count and repro result, and review it per file, edit, revert or ask for changes.
- **Change ID:** implementer-patch
- **PRD refs:** US-06, FR-047, FR-048, FR-049, FR-050
- **Prerequisites:** S-02, S-05
- **Parallel with:** S-08, S-11, S-12, S-17
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The implementer edits only its own worktree and holds no credentials (NFR Isolation); push is a separate, signed step in S-14.
- **Status:** proposed
- **Tasks:** [S-13 in roadmap-tasks.md](roadmap-tasks.md#s-13-implementer-patch)

### S-14: Push patch and recheck

- **Outcome:** user can push the patch to the PR branch after typing the PR number and signing, and see the next chain round check that fix.
- **Change ID:** push-patch-and-recheck
- **PRD refs:** US-06, FR-051
- **Prerequisites:** S-07, S-13
- **Parallel with:** S-16, S-17, S-18
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Push is never forced and is refused if the head moved (F-03 rule); the commit carries `Co-authored-by` the signer (OQ3 provisional).
- **Status:** proposed
- **Tasks:** [S-14 in roadmap-tasks.md](roadmap-tasks.md#s-14-push-patch-and-recheck)

### S-15: Level 5 autofix

- **Outcome:** user can see a level 5 PR fixed and pushed by the bot only when every autofix condition holds (at most N automatic patches per chain, default 2), or waiting with the reason, and see at lower levels what level 5 would have done.
- **Change ID:** level5-autofix
- **PRD refs:** US-07, FR-052, FR-053
- **Prerequisites:** S-10, S-14
- **Parallel with:** S-16, S-17, S-18
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Highest-autonomy behaviour, so it comes last in the fixing stream and reuses the exact P conditions from F-03.
- **Status:** proposed
- **Tasks:** [S-15 in roadmap-tasks.md](roadmap-tasks.md#s-15-level5-autofix)

### S-16: Fork PRs read-only

- **Outcome:** user can start a review of a fork PR only by hand, and that review only reads the code: no auto-review, install, scripts, implement or push.
- **Change ID:** fork-prs-read-only
- **PRD refs:** US-17, FR-026, NFR Isolation
- **Prerequisites:** S-04, S-07
- **Parallel with:** S-08, S-11, S-12, S-13, S-17
- **Blockers:** —
- **Unknowns:** —
- **Risk:** WB rarely gets fork PRs, but a missed guard runs untrusted code; the guard sits in the run state machine, not in each stage.
- **Status:** proposed
- **Tasks:** [S-16 in roadmap-tasks.md](roadmap-tasks.md#s-16-fork-prs-read-only)

### S-17: Board filters, search and shortcuts

- **Outcome:** user can read full board cards, filter by Person, Repository and level, see Action needed sorted by urgency, drafts and Ready to merge in their compact forms, search PRs, people, settings and actions, triage findings by keyboard, and switch light/dark theme.
- **Change ID:** board-filters-search-shortcuts
- **PRD refs:** FR-006, FR-007, FR-008, FR-009, FR-011, FR-012, FR-013, NFR Accessibility, NFR Layout
- **Prerequisites:** S-02, S-08 (keyboard opinions need S-08; the other tasks can start after S-02)
- **Parallel with:** S-09 to S-16, S-18 to S-23 (UI-only on existing data)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pure UI on existing data, the best filler for a spare agent run; the Person filter replaces an Inbox (PRD Non-Goals).
- **Status:** proposed
- **Tasks:** [S-17 in roadmap-tasks.md](roadmap-tasks.md#s-17-board-filters-search-shortcuts)

### S-18: Activity and alerts

- **Outcome:** user can see active alerts (failed runs with Retry, chains out of rounds with a fix still needed, an expensive PR, the daily budget reached) in Activity, receive each as a ClickUp comment on the PR's task linking to the app (OQ13), and dismiss them; thresholds use defaults until S-21 adds their Settings page.
- **Change ID:** activity-and-alerts
- **PRD refs:** US-14, FR-064, FR-065, FR-066, FR-067
- **Prerequisites:** S-06, S-09
- **Parallel with:** S-14, S-15, S-17, S-19, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** No alerts when things go well (PRD Non-Goals); the cost alert must clear by itself.
- **Status:** proposed
- **Tasks:** [S-18 in roadmap-tasks.md](roadmap-tasks.md#s-18-activity-and-alerts)

### S-19: Pilot metrics in Insights

- **Outcome:** user can read the five pilot metrics with sample sizes in Insights → Overview, real spend in Cost, verdict and acceptance rates in Quality, and the per-repository Trust ladder with the level 5 shadow log.
- **Change ID:** pilot-metrics-insights
- **PRD refs:** US-15, FR-069, FR-070, FR-071, FR-072
- **Prerequisites:** S-05, S-15 (only the shadow-log task needs S-15)
- **Parallel with:** S-16, S-17, S-18, S-20
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Metrics are computed from logs kept since S-01 (NFR Complete logs); lane and head-change rows are back-filled from the stored raw GitHub events; no trends or deltas during the pilot.
- **Status:** proposed
- **Tasks:** [S-19 in roadmap-tasks.md](roadmap-tasks.md#s-19-pilot-metrics-insights)

### S-20: Connect a repository in Settings

- **Outcome:** user can connect any repository the GitHub App can access and set its default level, branch, install command and other RepositoryConfig values through Settings alone, with a save bar that shows what each page affects, and see GitHub and ClickUp connection status and event delivery health.
- **Change ID:** connect-repository-in-settings
- **PRD refs:** US-16, FR-001, FR-002, FR-073, FR-077, NFR Repository-agnostic, NFR Accountability
- **Prerequisites:** S-01
- **Parallel with:** S-02 to S-19
- **Blockers:** —
- **Unknowns:**
  - Which repositories follow WB in the first 3 months (OQ7). — Owner: Alek. Block: no.
- **Risk:** Replaces S-01's seeded WB config; the proof is connecting a second repository with zero code change.
- **Status:** proposed
- **Tasks:** [S-20 in roadmap-tasks.md](roadmap-tasks.md#s-20-connect-repository-in-settings)

### S-21: Models, levels and audit log

- **Outcome:** user can set the model for each agent role, see the review level ladder 1–6 and set default levels, set the alert thresholds and the general alerts task (signed), and search the audit log of every signed settings change with before and after values.
- **Change ID:** models-levels-and-audit-log
- **PRD refs:** FR-068, FR-075, FR-078, FR-082, NFR Accountability
- **Prerequisites:** S-18, S-20
- **Parallel with:** S-19, S-22
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Model names are validated against flag injection (F-03 config-resilience rule).
- **Status:** proposed
- **Tasks:** [S-21 in roadmap-tasks.md](roadmap-tasks.md#s-21-models-levels-and-audit-log)

### S-22: Instructions and pipeline

- **Outcome:** user can view and edit instruction files by scope (global, repository, level copy) as signed new versions, try a draft on a PR (unsigned, "Started by hand"), and view the pipeline as a read-only diagram with each stage's model and instructions.
- **Change ID:** instructions-and-pipeline
- **PRD refs:** US-12, FR-003, FR-079, FR-080, FR-081
- **Prerequisites:** S-07, S-20
- **Parallel with:** S-21, S-17, S-18, S-19
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Version 1 is a read-only copy of `~/Projects/wb-factory/knowledge` (OQ15); a broken file falls back field by field with a warning.
- **Status:** proposed
- **Tasks:** [S-22 in roadmap-tasks.md](roadmap-tasks.md#s-22-instructions-and-pipeline)

### S-23: Learning from closed PRs

- **Outcome:** user can see the analyst run after a level 6 PR closes (or run it by hand), review at most 5 lesson candidates, edit, try, reject or accept them (signed), and see the learning status on the PR; accepted lessons become a new lessons-file version.
- **Change ID:** learning-from-closed-prs
- **PRD refs:** US-13, FR-062, FR-083, FR-084, FR-085, FR-086
- **Prerequisites:** S-08, S-22
- **Parallel with:** S-15, S-17, S-18, S-19, S-21
- **Blockers:** —
- **Unknowns:** —
- **Risk:** A lesson needs at least 2 PRs, excludes the author's own comments, and a person accepts every one (F-03 learning rules).
- **Status:** proposed
- **Tasks:** [S-23 in roadmap-tasks.md](roadmap-tasks.md#s-23-learning-from-closed-prs)

## Backlog Handoff

| Roadmap ID | Change ID                      | Suggested issue title                                   | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------------ | ------------------------------------------------------- | --------------------- | ----- |
| F-01       | monorepo-foundations           | Scaffold pnpm monorepo with lint, tests, CI, AGENTS.md  | yes                   | Run `/10x-plan monorepo-foundations` |
| F-02       | local-data-and-jobs            | Local Postgres, Drizzle migrations and pg-boss          | no                    | After F-01 |
| F-03       | domain-core-acceptance-tests   | Port domain rules and tests into packages/core          | no                    | After F-01; parallel with F-02 |
| F-04       | pilot-hosting-and-access-gate  | Host the app behind a shared access gate                | no                    | Blocked on OQ5/6 (Alek) |
| S-01       | first-review-round             | Round 1 on a ready WB PR with findings on the PR page   | no                    | After F-02, F-03; real wiring needs Alek |
| S-02       | board-and-signed-decision      | Board lanes and signed decisions on findings            | no                    | North star |
| S-03       | live-round-progress            | Live round progress, run detail and timeline            | no                    | — |
| S-04       | round-checks-and-change-type   | Checks stage in a sandbox and change type               | no                    | — |
| S-05       | verified-findings              | Verifier verdicts with quote and repro evidence         | no                    | — |
| S-06       | clickup-task-context           | ClickUp task link, context and follow-up tasks          | no                    | Real wiring needs Alek |
| S-07       | manual-start-and-chains        | Manual start, chains and new-commits handling           | no                    | — |
| S-08       | questions-and-signed-reviews   | Questions, signed reviews and author notice             | no                    | — |
| S-09       | retry-and-cancel               | Retry from failed stage and cancel                      | no                    | — |
| S-10       | pause-budget-and-queue         | Pause, daily budget, agent slots and Queued reasons     | no                    | — |
| S-11       | sensitive-files-approval       | Sensitive files approval                                | no                    | — |
| S-12       | merge-from-app                 | Merge checklist and signed merge                        | no                    | Branch protection needs Alek |
| S-13       | implementer-patch              | Implement with agent and patch review                   | no                    | — |
| S-14       | push-patch-and-recheck         | Signed push of the patch and fix recheck                | no                    | — |
| S-15       | level5-autofix                 | Level 5 autofix and shadow log                          | no                    | — |
| S-16       | fork-prs-read-only             | Read-only manual review of fork PRs                     | no                    | — |
| S-17       | board-filters-search-shortcuts | Board filters, search, shortcuts and theme              | no                    | — |
| S-18       | activity-and-alerts            | Activity alerts delivered to ClickUp                    | no                    | — |
| S-19       | pilot-metrics-insights         | Insights: pilot metrics, cost, quality, trust ladder    | no                    | — |
| S-20       | connect-repository-in-settings | Connect and configure repositories in Settings          | no                    | — |
| S-21       | models-levels-and-audit-log    | Models, levels, alert settings and audit log            | no                    | — |
| S-22       | instructions-and-pipeline      | Versioned instructions, trials and pipeline view        | no                    | — |
| S-23       | learning-from-closed-prs       | Analyst lessons after closed level 6 PRs                | no                    | — |

## Open Roadmap Questions

PRD Open Questions 2, 3 (signer trailers), 8–15 and 17–19 hold their provisional answers from `docs/08-orchestrator-log.md` and are planned as decided. These stay open:

1. **Timeline.** How many weeks is v1, and is there a hard deadline? (PRD OQ1) — Owner: Alek. Block: no (ordering is by dependency).
2. **Model access and budget.** Organisation account, key owner, monthly cap (PRD OQ4). — Owner: Alek. Block: real-wiring tasks of S-01 onward; code proceeds behind `AgentRunner`.
3. **Where it runs, and may repository code go to a vendor's hosted sandbox?** (PRD OQ5) — Owner: Alek. Block: F-04.
4. **Access gate type and who sets it up** (PRD OQ6). — Owner: Alek with infrastructure. Block: F-04.
5. **Branch protection per repository** (PRD OQ3, the part left to Alek). — Owner: Alek. Block: no (S-12 shows GitHub's reason).
6. **Repositories after WB** (PRD OQ7). — Owner: Alek. Block: no (S-20 keeps everything in RepositoryConfig).
7. **Alert comments link to the app** (PRD OQ13; Alek can still say no). — Owner: Alek. Block: no (S-18 default: they link).
8. **Switching off the prototype apps before the pilot** (PRD OQ16). — Owner: Alek. Block: roadmap-wide for the pilot only, not for building.

## Parked

- **Sign-in, per-user accounts, roles, permission checks** — PRD Non-Goals; the gate lives outside the app.
- **Inbox page** — PRD Non-Goals; the Person filter (S-17) replaces it.
- **Editable pipeline diagram** — PRD Non-Goals; S-22 is read-only.
- **Anything beyond one sentence in GitHub** — PRD Non-Goals, NFR Privacy toward public PRs.
- **Automatic review on push, quiet period, per-PR dollar cap** — PRD Non-Goals.
- **Cost estimates before an action** — PRD Non-Goals; only real spend.
- **Automatic retry of a failed stage** — PRD Non-Goals; Retry stays a person's button (S-09).
- **Fake or simulated agent mode** — PRD Non-Goals; test doubles live only in tests.
- **Review per package for big PRs** — OQ14 provisional answer: later slice; v1 has per-stage timeout, Retry and a large-PR warning.
- **Measures not taken in the first phase and "later" measures** — PRD Non-Goals; shown as "Not measured yet".
- **Multi-tenancy** — PRD Non-Goals (one organisation, nothing that blocks more later).
- **Trends, deltas, "X% better" in Insights; alerts when things go well** — PRD Non-Goals.
- **Changes to WB Factory (prototype)** — PRD Non-Goals; reference only.
- **Import of past runs, lessons or decisions** — OQ15 provisional answer: start empty; only instruction files become version 1.

## Done

