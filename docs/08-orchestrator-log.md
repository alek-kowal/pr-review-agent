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
