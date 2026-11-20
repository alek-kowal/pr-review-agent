# Orchestrator state: PR Review Agent

The resume point for the orchestrator (the main Claude session in Herdr workspace `w2`, pane
`w2:p1`). In a fresh session or after a compaction, read in this order:

1. this file (where we are, what is next),
2. `docs/JOURNAL.md` (what happened, in order; append to it after every step),
3. `docs/orchestrator-lessons.md` (recurring problems and how to avoid them),
4. `tools/orchestrator/README.md` (the scripts).

Decisions in detail and the "For Alek" notes: `docs/08-orchestrator-log.md`. Work packages and the
"Needs Alek" table: `context/foundation/work-packages.md`.

## Working with Alek

- Talk to Alek in Polish, simple words. Project documents in English. The app UI is in English.
- Every task runs in a fresh agent session in its own worktree; no session past ~30% context
  (`supervise.sh` hands off at 26%). Independent tasks run in parallel (up to 6 agents).
- Use `/10x-impl-review` only for complex packages. Save context: chain scripts in one background
  command and let notifications wake you; read agent results with `grep '⏺' | tail`.
- Make reasonable decisions yourself; ask Alek only what is truly his.
- Keep the journal: one short entry in `docs/JOURNAL.md` after every merge, deploy, decision or
  incident.

## Hard limits

- Never create external accounts, a GitHub App, API keys or anything paid; never print a secret.
  Secrets on the VPS are entered by Alek in `/etc/pra/pra.env` himself.
- Never touch the old apps on :4300/:4400 or `~/Projects/wb-factory*` beyond reading (GET only).
- Push only to `alek-kowal/pr-review-agent` (no force-push to main), plus the deploy repo on the
  VPS through `deploy/mikrus/deploy.sh`.
- No runtime fake mode. Test doubles only in tests and `/testing` exports.
- Never delete other projects' Docker data on the Mac.
- Root SSH to the Mikrus VPS is allowed by a permission rule Alek added on 20 Nov (`baza` and `kurs`
  run there too: check them after any server change).

## Where we are (20 Nov 2026, 02:35)

- All 24 roadmap packages are merged, plus reviews (P-03r, P-05r, P-11r, P-18r, P-22r), P-25
  (Claude subscription auth), P-26 (OpenRouter judge), P-27 (Mikrus deploy kit), P-28 (GitHub
  polling in token mode), FLAKY, CONNECT and README. main `5a566e3`, CI green on `53e3de6`.
- **Deployed** on the Mikrus VPS `wojtek118` (1 vCPU, 4 GB, unprivileged LXC, runc sandbox) at
  `https://dashboardwb.mikrus.dev`, behind a basic-auth gate (login `synergy`, the password is
  with Alek). Deploy: `deploy/mikrus/deploy.sh` from the Mac (`deploy/mikrus/deploy.env`, local,
  gitignored), about 3 minutes.
- GitHub: no App yet (Alek is not an org owner). The app polls with Alek's fine-grained read-only
  token, every 5 min, 9:00–17:00 Mon–Fri; read-only on GitHub. Repository connected:
  `synergycodes/workflowbuilder` (id 1, public, 18 open PRs).
- Models: Claude via Alek's subscription token; the judge can use OpenRouter (key set). ClickUp key
  set, ClickUp not wired to WB IDs yet.
- No agent is running.

## Next step

1. Alek runs the first poll ("Refresh from GitHub" on the board; it only records a baseline) and
   starts a first review on one WB PR. Watch the worker log:
   `ssh -p 10118 -i ~/.ssh/mikrus root@wojtek118.mikrus.xyz 'journalctl -u pra-worker -f'`.
2. Size the sandbox: on the VPS as `pra`, `cd app && pnpm sandbox:bench --repo
   https://github.com/synergycodes/workflowbuilder.git --slug workflowbuilder --fresh`, then once
   more without `--fresh`; set `SANDBOX_MEMORY_MB` and timeouts in `/etc/pra/pra.env` from it.
3. Later, when Alek gets the GitHub App: follow the switch-over steps in the S-01-T16 row of "Needs
   Alek"; polling stops by itself.
4. Open proposals waiting for Alek: simple packages on Sonnet; a higher per-session context
   budget (see the 20 Nov 01:15 entry in `docs/08-orchestrator-log.md`).

## How to run a package

```sh
T=tools/orchestrator
$T/spawn-task.sh <ID> $T/prompts/<prompt>.txt   # worktree, tab, agent t-<id>, prompt
$T/supervise.sh t-<id> &                         # background; wake on FINISHED/BLOCKED/GONE
# after FINISHED: read the agent's last ⏺ lines, then
$T/merge-or-fix.sh <ID>                          # MERGED, or FIXING (merge-fix agent started)
deploy/mikrus/deploy.sh                          # when the change should go live
$T/ci-wait.sh <sha>
```

Write the prompt from `prompts/package.txt` (roadmap package) or a recent one-off prompt
(`p28.txt`, `connect-flow.txt`) as a model: goal, context, numbered steps, the orchestrator rules,
the "Never" list, a Polish final reply of at most 4 lines.
