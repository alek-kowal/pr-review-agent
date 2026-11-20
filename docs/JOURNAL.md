# Journal

What happened, in order, one short entry per step: what was done, the result, what is next.
The orchestrator appends an entry after every merge, deploy, decision or incident. Decisions in
detail: `docs/08-orchestrator-log.md`. Where we are now: `docs/ORCHESTRATOR-STATE.md`. Lessons:
`docs/orchestrator-lessons.md`. Scripts: `tools/orchestrator/`.

Times are Europe/Warsaw.

## 18 Nov 2026: analysis, design, plan

- Analysis of the two vibe-coded WB Factory prototypes (`docs/01-analysis.md`): rewrite fresh,
  keep plain `wb-factory` as the reference for domain rules and tests.
- Design: a clickable HTML prototype (`prototype/`), approved. Decisions: one shared account,
  signed actions (`docs/04-accounts-and-signatures.md`); a push never starts a review
  (`docs/05-review-triggers.md`).
- PRD, tech stack, roadmap and 24 work packages in `context/foundation/`. Private repo
  `alek-kowal/pr-review-agent`. Name: PR Review Agent (any project; Workflow Builder first).

## 19 Nov: the roadmap, built by parallel agent sessions

- 04:13–08:21 Waves 1–5 merged: P-01..P-13, the parity pass P-02b, reviews P-03r and P-05r
  (critical: a round could stay "running" forever, fixed), stable tests P-06f, P-11 (chains).
- 05:50 Disk full (Docker): freed build cache and leftover sandbox containers; supervisor stops
  below 4 GB.
- 08:40–12:28 All agents stopped on the subscription usage limit; the 10:20 auto-resume hit a
  DNS outage. Re-prompted by hand.
- 12:50–15:18 Merged P-11r (sensitive-file scan could let "Ready to merge" through, fixed),
  P-19, P-16, P-14, P-17, P-15, P-23, P-24, P-20. Migration-number races made several packages
  need merge-fix sessions; lesson: merge one at a time.
- 15:15 main went red after two clean merges (P-23 + P-24 typecheck); P-20 fixed it.
  `merge-task.sh` now verifies the merge result before landing.
- 15:18–17:38 Second usage-limit stop; auto-resume again hit DNS; re-prompted.
- 17:54–21:38 Merged P-21, README (hero, diagram, screenshots), P-18, P-18r (critical: the
  implementer could write `.git` and run commands on the worker with its secrets, fixed), P-22,
  P-22r (10 fixes, e.g. the bot pushed despite a pause). **All 24 roadmap packages merged.**
- 22:37 P-25: agents run on Alek's Claude subscription (`CLAUDE_CODE_OAUTH_TOKEN`), costs shown
  as API-equivalent, a usage-limit pause waits for the reset. Alek is the only user for now.
- 23:33 P-26: the change-type judge can run on OpenRouter (e.g. `typesafe/jev-router`), with
  data_collection deny, routed model and cost recorded, fallback to Claude, `pnpm judge:compare`.
- 23:45 FLAKY: `decide.spec.ts` exposed a real bug ("Defer" silently overwrote another person's
  decision), fixed; sandbox tests clean up their containers.
- 23:00–23:50 Mikrus VPS cleanup on Alek's request: removed n8n, cezar, code-server, paperclip,
  DevMentor; RAM free 2.5 → 3.5 GB, disk 11 → 27 GB. `baza` and `kurs` untouched.

## 20 Nov

- 00:16 gVisor tested on Mikrus: fails in the unprivileged LXC (cgroup device filter). Decision:
  runc with sandbox caps on Mikrus; gVisor waits for a KVM VM. Rolled back.
- 00:24 P-27: Mikrus deploy kit (`deploy/mikrus/`), two concurrency limits (Claude stages 3,
  sandbox 1), sandbox caps, `pnpm sandbox:bench`.
- 00:30–01:05 Server bootstrap by the orchestrator (Alek granted SSH permission): user `pra`,
  bare repo, Postgres 17 (localhost), systemd units and timers, nginx site
  `dashboardwb.mikrus.dev` behind a basic-auth gate (login `synergy`; the password is with Alek).
  Alek put the secrets into `/etc/pra/pra.env` himself (Claude token, OpenRouter, ClickUp,
  GitHub token).
- 01:15 First deploy (518358f), 3 min: app up behind the gate, subscription auth, 29 migrations.
- 01:38 P-28: no GitHub App yet (Alek is not an org owner), so the app polls GitHub with a
  personal token: every 5 min, 9:00–17:00 Mon–Fri; first poll is a baseline; read-only on
  GitHub; connect a repository by name. Deployed.
- 01:48 Fix: an empty Team made "Connect" look dead (the "pick your name" error was hidden).
  Deployed.
- 02:00 Alek connected `synergycodes/workflowbuilder` (repository id 1).
- 02:22 CONNECT: after Connect the page now lands on the repository list with no "Reload site?"
  prompt (the leave guard outlived the save); "Refresh from GitHub" button on the board.
  Deployed 5a566e3.
- 02:35 Orchestrator scripts moved from the session scratchpad to `tools/orchestrator/`; this
  journal started. Next: Alek's first poll and first review on a WB PR; then `pnpm
  sandbox:bench` on WB to size the sandbox limits.
- 02:40 Incident: Alek's first review (WB #282, level 3, by hand) failed at Verify with the raw
  code `verifier_instructions_missing` after Review spent $0.82. Cause: `instruction_files` on
  the VPS was empty (`pnpm instructions:import` never ran); only the reviewer has a built-in
  fallback. Spawned INSTR (`prompts/instr.txt`): readable copy for every stage error code, fail
  the round before any agent when required files are missing, a warning before "Start review",
  `deploy/mikrus/import-instructions.sh`.
- 02:43 On Alek's request: DB backup `/var/backups/pra/before-instructions-import-20261120-0241.dump`,
  then `pnpm instructions:import --from /var/lib/pra/knowledge-import` (read-only copy of
  `~/Projects/wb-factory/knowledge`) as `pra`: 25 files as version 1 (24 for workflowbuilder, 1
  global). A run with no frozen versions reads the active ones, so "Retry from Verify" on #282
  uses them.
- 02:55 Alek asked about instruction versions, feature maps and the stage→file mapping. Findings:
  rollback exists (file → Version history → "Roll back to v{n}…", only for once-active
  versions); no delete and no "Discard draft" (the prototype had it); feature maps reach only the
  reviewer as files in its `knowledge/` dir, read only if its prompt says so;
  `review-levels.json` and `review-profiles.json` are imported but unused (levels live in the DB);
  the prototype's "Read by" column was dropped without a decision; Settings → Pipeline lists
  global files only, so after the repository-scoped import it shows Verify etc. as "built in"
  (wrong). Proposed a follow-up package INSTR-UI after INSTR; waiting for Alek's choice.
- 03:05 Decision (Alek): the Pipeline side sheet lets him pick each stage's instruction files
  (dropdown per slot), reversing "read-only pipeline"; instructions and supporting documents are
  separate kinds. His missing rollback button: his only v2 (feature-map/temporal.md) is an
  unactivated draft. Package STAGEFILES (`prompts/stagefiles.txt`): file kinds, stage slots with
  global → repository assignment frozen per run, scope picker in Pipeline (fixes the global-only
  bug), "Make active" on any version, "Discard draft". Starts after INSTR merges (same files).
- 03:15 Alek (going to sleep): bigger changes use the 10x workflow (`/10x-plan` →
  `/10x-plan-review` → `/10x-implement` → `/10x-impl-review`); added to STAGEFILES' prompt and
  to the state file. Asked for a recommendation file by morning, no code changes: primitives and
  course knowledge for an "AI Software Factory", then dead code and simplifications. Two research
  subagents started (courses, app concepts). Night plan in `docs/ORCHESTRATOR-STATE.md`.
- 03:50 INSTR merged and deployed (7ba2be2), CI green: readable copy for every stage error
  code, a round stops before its first stage when required instruction files are missing,
  warnings in "Start review" and Settings → Instructions, `deploy/mikrus/import-instructions.sh`.
  verify 1740 tests, e2e 87 passed / 1 skipped. `kurs` and `wiedza-watch` still running on the VPS.
- 03:52 STAGEFILES spawned (10x workflow), under `supervise.sh`.
- 03:52 Recommendation Part A written (`docs/recommendations/2026-11-20-night-review.md`):
  only two primitives are missing (Work item, Pipeline as data); Plan as the second pipeline;
  position the app as the control plane, the reviewer as a swappable slot. Part B (dead code)
  follows after STAGEFILES lands.
- 04:55 STAGEFILES merged and deployed (9f66f28), CI green; DB backup before deploy
  `/var/backups/pra/before-stagefiles-20261120-0449.dump`. 10x workflow: plan, plan review,
  5 phases over 4 sessions, impl review (NEEDS ATTENTION, no criticals; 9 of 10 fixed, extra list
  queries left). verify 1807 tests, e2e 88 passed / 1 skipped. Checked on real data via the API on
  the VPS (read-only): Pipeline for workflowbuilder now shows every slot's repository file at v1;
  migration set 11 instruction and 14 document files. Alek's visual checks (plan 4.4, 4.5) remain.
- 04:58 Part B (dead code) started as a read-only subagent. The first brief (download knip via
  `pnpm dlx`, include orchestrator scripts) was refused by the permission classifier; the second
  keeps to app code, grep and reads only.
- 05:20 Part B written (read-only, the repo's own TypeScript compiler from a scratch folder plus
  grep): 44 unused exports (~300 lines), 14 unused copy keys, 5 API routes the web never calls,
  4 unread DB columns, 9 duplicate concepts, 10 simplifications (~1,500 lines), 10 small packages
  in order. Top item: generate the web's API types from the Zod schemas. Open choice for Alek:
  `POST /api/instructions/:id/copies` has no button. Night plan done; file committed.
- (later, 20 Nov) Alek, via the side-questions session: the PR timeline said "Alert posted as a
  ClickUp comment" on #282 although nothing was sent (`alert_raised` is written in
  `evaluate.ts` before delivery; the alert was `not_configured`). Spawned ALERTTL
  (`prompts/alert-timeline.txt`): neutral "Alert raised" entry, a delivery entry only after the
  attempt with a specific reason or retry status, old entries stop saying "posted".
- ALERTTL merged and deployed (8061390), CI green; DB backup `before-alerttl-*.dump` in
  `/var/backups/pra/`. Timeline: neutral "Alert raised: …" plus an `alert_delivery` entry written
  after the attempt (posted to task X / not sent with a specific reason / failed, retry n of 6 or
  gave up). New column `alerts.delivery_reason` (migration 0031); old entries read the state from
  the alerts table, so #282 now shows "Not sent to ClickUp: no ClickUp task to comment on".
  Activity column "Posted" renamed "When". verify 1816, e2e 88 / 1 skipped. `kurs` and
  `wiedza-watch` active.
- Alek: the Pull requests board should hide fork PRs by default. The `forks` filter exists
  (`hide`/`only`/none = all); spawned FORKS (`prompts/fork-filter.txt`): no param = hide, an
  explicit "show all", "Clear filters" keeps forks hidden.
- Alek: run details list "Instruction versions" as one list; instructions must always be shown
  apart from documents (feature maps etc.), everywhere. Spawned KINDS
  (`prompts/kinds-everywhere.txt`): run details split, every other list of instruction files,
  and a one-line rule in AGENTS.md (Web). Runs in parallel with FORKS (different files).
- FORKS merged and deployed (42e7a02), CI green: the board hides fork PRs by default
  (`forks=all` shows every PR, `only` forks only); a "Forks hidden" hint with "Show forks"; the
  API default is unchanged, the web sends `forks=hide`.
- KINDS merged and deployed (36c2404), CI green: run details and Insights → Quality show
  Instructions apart from Documents (documents collapsed above 5), the API returns each frozen
  file's kind (no migration), kind badge in the editor, rule added to AGENTS.md (Web). Other
  views checked: they list no files. `kurs` and `wiedza-watch` active.
