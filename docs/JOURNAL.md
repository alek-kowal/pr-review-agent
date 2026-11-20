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
