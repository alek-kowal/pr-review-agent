---
project: PR Review Agent
version: 1
status: draft
created: 2026-11-19
updated: 2026-11-19
sources: roadmap.md v1, roadmap-tasks.md (230 tasks)
---

# Work packages: PR Review Agent

> Groups the tasks of [`roadmap-tasks.md`](roadmap-tasks.md) into packages that one fresh agent session implements directly. Task text, "Done when" checks and Alek's steps stay in `roadmap-tasks.md`; this file only groups, orders and adds the rules for running packages in parallel.
> Not packaged: F-01 (another agent is implementing it now) and the 19 **Needs Alek** tasks, listed at the end with their setup steps.
> Result: **202 tasks in 24 packages, 8 waves.** 11 packages need a plan first.

## How to run a package

- Start a fresh session with: "Implement P-xx from `context/foundation/work-packages.md`". The agent reads this file's block for P-xx, the listed tasks in `roadmap-tasks.md`, and `AGENTS.md`.
- **Plan: yes** — run `/10x-plan` for the package's tasks first (plan saved under `context/changes/<package-id>-<slug>/`), then implement. **Plan: no** — the tasks' "Done when" checks are the plan; implement in the listed order.
- Work the tasks in the listed order. Each task's "Done when" must pass before the next starts; commit once per task.
- Size budget: about 25% of a 1M-token context. If a session gets there early, it finishes the current task, commits, and a follow-up session in the same wave takes the rest.
- Packages in one wave run in parallel. They merge in id order; each later package rebases on `main` and reruns `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e` before it merges.
- No package waits for a Needs Alek task. Integrations are tested with doubles; real wiring is Alek's list at the end.
- The notes in each block override the task text where they say so (they remove duplicate tables and functions, or move a call site).

## At a glance

| Wave | Packages (parallel) | Tasks |
| --- | --- | --- |
| 1 | P-01 Local data and jobs · P-02 Domain core | 20 |
| 2 | P-03 Integrations and deploy · P-04 Data model and PR page | 14 |
| 3 | P-05 Round 1 engine · P-06 Sandbox and adapters · P-07 Team, signatures and Settings shell | 19 |
| 4 | P-08 Board and signed decisions · P-09 Round stages and repositories · P-10 Live backend and timeline | 22 |
| 5 | P-11 Manual start, chains and sensitive files · P-12 Live UI and ClickUp task · P-13 Verdicts and Insights | 29 |
| 6 | P-14 Questions and signed reviews · P-15 Retry, cancel and stage outputs · P-16 Pause, budget and queue · P-17 Instructions, trials and pipeline | 39 |
| 7 | P-18 Implementer and fork PRs · P-19 Merge from the app · P-20 Alerts · P-21 Learning | 31 |
| 8 | P-22 Push, autofix and shadow log · P-23 Models, levels and audit log · P-24 Board filters, search and shortcuts | 28 |

**Plan: yes** — P-03, P-05, P-06, P-10, P-11, P-15, P-16, P-17, P-18, P-19, P-22 (agent runtime, run engine and state machines, concurrency, sandbox isolation, GitHub writes, budget). All others: no.

Critical path: P-02 → P-04 → P-05 → P-08 → P-11 → P-15/P-16 → P-18 → P-22.

## Hot files

Files that several packages change structurally. Two packages that edit the same hot file are never in the same wave. Paths are the planned layout from `AGENTS.md` and the task text.

| ID | Files | Edited by (wave) |
| --- | --- | --- |
| H1 | Stage runner: `apps/worker/src/run/execute-stage.ts` (the `run.stage` handler) | P-05 (3), P-10 (4), P-15 (6) |
| H2 | Run creation: `apps/worker/src/run/start-round.ts`, `create-run.ts` | P-11 (5), P-17 (6), P-18 (7), P-23 (8) |
| H3 | Pull request webhook handling: `apps/worker/src/handlers/github-event.ts` | P-05 (3), P-11 (5) |
| H4 | Reviewer: `packages/agents/src/reviewer/**`, `apps/worker/src/stages/review.ts` | P-03 (2), P-05 (3), P-09 (4), P-11 (5), P-17 (6) |
| H5 | Agent runner: `packages/agents/src/runner.ts` | P-03 (2), P-10 (4), P-15 (6) |
| H6 | Core run machine and levels: `packages/core/src/run.ts`, `levels.ts` | P-02 (1), P-18 (7), P-23 (8) |
| H7 | PR state: `packages/core/src/pr-state.ts`, `packages/db/src/queries/pr-state.ts` | P-02 (1), P-08 (4), P-11 (5), P-14 (6), P-18 (7) |
| H8 | Config schemas: `packages/core/src/config.ts` | P-02 (1), P-06 (3), P-16 (6), P-23 (8) |
| H9 | PR page frame: `apps/web/src/features/pr/{PrPage,PrHeader,NextStepBanner,Checklist}.tsx` | P-04 (2), P-08 (4), P-11 (5), P-14 (6), P-19 (7) |
| H10 | Findings tab: `apps/web/src/features/findings/{FindingsTab,Finding,DecisionForm,BulkBar}.tsx` | P-04 (2), P-08 (4), P-14 (6), P-18 (7), P-24 (8) |
| H11 | Board: `apps/web/src/features/board/**`, `apps/api/src/routes/board/**` | P-08 (4), P-20 (7), P-24 (8) |
| H12 | App shell: `apps/web/src/routes/__root.tsx`, top bar, status chip | P-12 (5), P-16 (6), P-20 (7), P-24 (8) |
| H13 | CI and Playwright config: `.github/workflows/ci.yml`, `playwright.config.ts` | P-01 (1), P-03 (2), P-05 (3) |
| H14 | `AGENTS.md` and root `package.json` scripts | P-01 (1), P-04 (2), P-07 (3), P-17 (6), P-23 (8) |

**Shared but append-only** (not wave-separated; the later package rebases and fixes the conflict):

- Drizzle schema files and migrations. Each package keeps its schema in its own file under `packages/db/src/schema/`. It generates its migration last, after rebasing; if another migration landed first, it deletes its own and runs `pnpm db:generate` again.
- `pnpm-lock.yaml` (rerun `pnpm install`), barrel `index.ts` files, `apps/web/src/copy/*`, `routeTree.gen.ts`, `e2e/a11y-routes.ts`, `.env.example`.
- `e2e/support/stack.ts`: doubles are passed as options, so a package adds an option, not a new structure.
- New methods on `GitHubGateway` or `ClickUpGateway` (interface, adapter and fake each get one more method).
- Every registry listed under "Extension points".

## Extension points

These keep most shared files append-only. The package that builds the code they live in creates them; later packages add a file and one registration line.

| Created by | Extension point | Used by |
| --- | --- | --- |
| P-02 | Run kind union already includes `round`, `implementer`, `trial`, `analyst` | P-17, P-18, P-21 |
| P-04 | PR view API built from section builders; PR tab registry; `Finding` line and action slots | most UI packages |
| P-05 | Stage executor registry | P-09, P-18 |
| P-05 | Run lifecycle hooks: round completed, run failed, run cancelled, session cost recorded | P-10, P-11, P-14, P-20, P-22 |
| P-05 | Start gates `beforeRoundStart` and `beforeSession`, returning start or wait-with-reason | P-16 |
| P-05 | PR event hooks (ready, head changed, closed, merged) and an event-type handler map | P-10, P-13, P-15, P-19, P-21 |
| P-05 | Reviewer context providers (task, answers, instructions) | P-09, P-14 |
| P-07 | Settings page registry (S-20-T2) and `applySignedSettingsChange` (S-20-T1) | every Settings page |
| P-08 | Next step banner: main-action registry by state code and a secondary-line slot; PR page panel slot and header-action slot; board card badge slot | P-11 to P-24 |
| P-11 | `createRun({ pr, kind, level, plan })` under `startRound` | P-17, P-18, P-21 |
| P-12 | Status chip segments; Activity sections and row actions; Run detail stage-output renderers | P-15, P-16, P-20 |

## Decisions made while grouping

- **One audit log.** P-07 builds `settings_changes` (S-20-T1) first. S-02-T1 skips `audit_events`; S-10-T1 skips `agent_status` and `audit_entries` and keeps pause, budget, slots and time zone in `app_settings`.
- **Reuse, don't redo, F-03 functions:** S-03-T4 extends `roundLabel` (F-03-T7); S-17-T2 uses `actionNeededOrder` (F-03-T12); S-15-T1 wraps `autofixDecision` (F-03-T9); S-23-T1 builds on the learning rules (F-03-T11); S-21-T1 extends `resolveLevel` (F-03-T6); S-11-T1 uses `matchSensitiveFiles` (F-03-T5); S-17-T5 search and S-12-T1 `getCiStatus` reuse what exists.
- **Moved earlier than their item:** S-13-T1 (implementer adapter) to P-06, because it needs only `AgentRunner`; S-02-T1, T3, T5, T8 and S-20-T1, T2 to P-07, so Team, signatures and the signed-change log exist once before anything signs.
- **Moved later:** S-03-T14 to P-15 (its test cancels a run, which needs S-09); S-13 waits for S-09 and S-10 (its tests use cancel, pause and budget); all of S-17 to P-24 (S-17-T3's test needs opinions from S-08); S-20-T5 (retire the WB seed) to P-23, after every package that edits the seed.
- **Joined by need:** S-04-T6/T7 with S-09 (both render in Run detail); S-05-T3/T4 with S-19 (verdicts feed Quality); S-06-T8 with S-12 (it needs Run detail); S-19-T9 with S-15; S-21-T9 with S-18.
- **Call sites moved to avoid hot files:** S-03-T5 writes the signed-decision timeline entry inside `decideFindings` (P-07), not in P-08's route; ingest and round entries go through P-05's hooks. P-08's state loader already passes verdicts and reads only runs of kind `round`, so S-05-T3 and S-22's trials need no loader change.

## Packages

Size = task count and rough changed lines. Ranges like `S-03-T1–T7` include every task in between.

| ID | Wave | Tasks | Goal | Depends on | Plan | Hot | Size | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | 1 | F-02-T1–T6 | Postgres in Compose, Drizzle migrations by command, pg-boss worker, pino, `/health` and the local BlobStore | F-01 | no | H13, H14 | 6 · ~1.1k | Exports the BlobStore contract suite for P-03. |
| P-02 | 1 | F-03-T1–T14 | Domain rules and the PR state table in `packages/core` as reason-code acceptance tests | F-01 | no | H6, H7, H8 | 14 · ~2.0k | Small pure tasks; run kind union per Extension points. |
| P-03 | 2 | S-01-T4, S-01-T7, S-01-T8, F-04-T1–T5 | GitHubGateway, GitMirror and AgentRunner with doubles, plus Docker images, deploy Compose, S3 BlobStore, CSRF guard, Sentry and OTel | P-01, P-02 | yes | H4, H5, H13 | 8 · ~1.9k | F-04-T4 does not edit `apps/web`; P-04's `api.ts` sends the header. |
| P-04 | 2 | S-01-T1–T3, S-01-T12–T14 | Tables for repos, PRs, runs and findings, the WB seed, read API, PR list and PR page with the Findings tab | P-01, P-02 | no | H9, H10, H14 | 6 · ~1.5k | Creates PR view sections, tab registry and Finding slots. |
| P-05 | 3 | S-01-T5, S-01-T6, S-01-T9–T11, S-01-T15 | Webhook to round 1 to findings to one GitHub sentence, end to end with doubles | P-03, P-04 | yes | H1, H3, H4, H13 | 6 · ~1.8k | Creates the P-05 extension points; the comment job posts only for kind `round`. |
| P-06 | 3 | S-04-T1, S-04-T2, S-04-T4, S-05-T1, S-06-T1, S-06-T2, S-13-T1 | Sandbox and offline install, and the judge, verifier, implementer and ClickUp adapters, task-ID matching and repo ClickUp settings | P-03, P-04 | yes | H8 | 7 · ~1.8k | Adapters only; stages come in P-09 and P-18. |
| P-07 | 3 | S-02-T1, S-20-T1, S-02-T3, S-02-T5, S-20-T2, S-02-T8 | Team, the signature field, the signed-settings change log and the Settings shell with save bar | P-03, P-04 | no | H14 | 6 · ~1.4k | One audit log (see Decisions); Team page lives in the S-20 shell. |
| P-08 | 4 | S-02-T2, S-02-T4, S-02-T6, S-02-T7, S-02-T9, S-02-T10 | Board lanes from the core state table and signed decisions on findings (north star code) | P-05, P-07 | no | H7, H9, H10, H11 | 6 · ~1.6k | Loader passes verdicts, reads kind `round` only; creates banner, panel, header and card slots. |
| P-09 | 4 | S-04-T3, S-06-T3, S-04-T5, S-05-T2, S-20-T3, S-20-T6, S-20-T4, S-20-T7, S-20-T8 | Checks, Task, Change type and Verify stages, and connecting and configuring repositories with integration health in Settings | P-05, P-06, P-07 | no | H4 | 9 · ~2.0k | Repository pages cover every RepositoryConfig field, incl. P-06's. |
| P-10 | 4 | S-03-T1–T7 | Change notifications, SSE, live cost per turn, the timeline, and the run detail, timeline and status APIs | P-05, P-07 | yes | H1, H5 | 7 · ~1.6k | Decision timeline entry inside `decideFindings`; fires the session-cost hook. |
| P-11 | 5 | S-07-T1–T7, S-11-T1–T4 | Manual start at a level, chains with fix checks and the 3-round stop, head-moved handling, and sensitive-file approval | P-08, P-09, P-10 | yes | H2, H3, H4, H7, H9 | 11 · ~2.0k | Builds `createRun`; `startRound` calls P-05's gates; sensitive reset sits in the synchronize path. |
| P-12 | 5 | S-03-T8–T13, S-06-T4, S-06-T5 | Live updates and status chip, stepper and round line, Run detail, Timeline tab, Activity, and the ClickUp task and follow-ups on the PR page | P-08, P-09, P-10 | no | H12 | 8 · ~1.7k | Creates chip, Activity and Run detail extension points; replaces polling. |
| P-13 | 5 | S-05-T3, S-05-T4, S-19-T1–T8 | Verdicts with evidence on findings, and Insights Overview, Cost, Quality and Trust ladder | P-09, P-10 | no | — | 10 · ~2.0k | Uses P-10's `pr_state_changes`; head changes through PR event hooks. |
| P-14 | 6 | S-08-T1–T11 | Answers, signed opinions and reviews, who usually decides, carried opinions, View new results, and Notify author | P-11, P-12 | no | H7, H9, H10 | 11 · ~2.0k | Answers reach the reviewer through a context provider. |
| P-15 | 6 | S-09-T1–T7, S-03-T14, S-04-T6, S-04-T7 | Retry from the failed stage, cancel that stops spend, close cancels, restart safety, the reconcile poll, and Checks and change type on the PR page and Run detail | P-10, P-11, P-12 | yes | H1, H5 | 10 · ~1.9k | Edit `runner.ts` only if the abort signal is missing. |
| P-16 | 6 | S-10-T1–T7 | Pause and resume, daily budget, agent slots, and Queued with the reason everywhere | P-11, P-12 | yes | H8, H12 | 7 · ~1.4k | State in `app_settings`; gates registered through P-05; drainer is a new cron. |
| P-17 | 6 | S-22-T1–T11 | Versioned instructions by scope, trial runs with Compare, and the read-only pipeline diagram | P-09, P-11, P-12 | yes | H2, H4, H14 | 11 · ~2.0k | Extends S-01-T1's `instruction_versions`; trials via `createRun` with instruction overrides. |
| P-18 | 7 | S-13-T2–T7, S-16-T1–T4 | Implement with agent, patch review, edit, revert and revise, and read-only fork PRs | P-15, P-16 | yes | H2, H6, H7, H10 | 10 · ~2.0k | Implementer runs use `createRun`, P-15's cancel and P-16's gates unchanged. |
| P-19 | 7 | S-12-T1–T5, S-06-T8 | Merge checklist and signed squash merge pinned to the reviewed SHA, plus the ClickUp end-to-end test | P-11, P-12 | yes | H9 | 6 · ~1.2k | Never bypasses branch protection; `getCiStatus` exists from P-09. |
| P-20 | 7 | S-18-T1–T6, S-18-T8, S-21-T9 | Alerts evaluated, delivered as ClickUp comments, dismissable, with their signed Settings page | P-12, P-15 | no | H11, H12 | 8 · ~1.6k | Trials and analyst excluded from the cost alert. |
| P-21 | 7 | S-23-T1–T7 | Analyst after a level 6 PR closes, lesson candidates, and signed accept into the lessons file | P-14, P-17 | no | — | 7 · ~1.4k | Analyst model defaults to `claude-sonnet-5-5` until P-23. |
| P-22 | 8 | S-14-T1–T5, S-15-T1, S-15-T2, S-15-T3, S-15-T5, S-19-T9 | Signed non-forced push with the fix check, level 5 autofix, and the shadow log in Insights | P-13, P-16, P-18 | yes | — | 10 · ~1.9k | Patch cap uses core default 2; the second of P-22/P-23 to merge wires the level 5 setting. |
| P-23 | 8 | S-21-T1–T8, S-20-T5 | Models per role, level settings and default level, the Audit log, and retiring the WB seed with the repo-agnostic lint | P-09, P-11 | no | H2, H6, H8, H14 | 9 · ~1.7k | After it, Alek uses Settings → Repositories, not the seed. |
| P-24 | 8 | S-17-T1–T9 | Full cards, urgency sort, filters in the URL, command palette, keyboard triage, theme, and accessibility and layout checks | P-14, P-19 | no | H10, H11, H12 | 9 · ~1.7k | Merges last in wave 8 so `prsSignedBy` and the a11y check see every table and route. |

## Needs Alek

Not packaged. Each is real wiring with Alek's accounts; code never waits for it. "When" names the package that must be merged first. The "Done when" check for each is in `roadmap-tasks.md`. Recommended order: the local track first (S-01-T16 → S-01-T17 → S-01-T18 → S-02-T11 reaches the north star), hosting (F-04) whenever the host is chosen.

| Task | When | Exact steps for Alek |
| --- | --- | --- |
| S-01-T16 Create and install the GitHub App on WB | App anytime; delivery check after P-05 | 1. Org owning WB → Settings → Developer settings → GitHub Apps → New GitHub App (needs org owner). 2. Name `pr-review-agent`, homepage `https://github.com/alek-kowal/pr-review-agent`, no OAuth, no callback. 3. Webhook Active; URL = a new private https://smee.io channel (or `cloudflared tunnel --url http://localhost:3000`). 4. `openssl rand -hex 32` → App webhook secret and `.env` `GITHUB_WEBHOOK_SECRET`. 5. Repository permissions: Contents Read and write (or Read-only until P-19/P-22), Pull requests Read and write, Checks Read-only, Commit statuses Read-only, Metadata Read-only; no org or account permissions. 6. Events: Pull request, Pull request review, Check suite, Check run, Status. 7. Installable only on this account → Create. 8. App ID → `.env` `GITHUB_APP_ID`; generate a private key, move it outside the repo (e.g. `~/.config/pr-review-agent/github-app.pem`), `chmod 600`, path → `GITHUB_APP_PRIVATE_KEY_PATH`. 9. Install → Only select repositories → Workflow Builder; check its full name matches `githubFullName` in `packages/db/seeds/workflowbuilder.json`. 10. With the api running: `pnpm dlx smee-client --url <channel URL> --target http://localhost:3000/webhooks/github`, redeliver `ping`, then `psql "$DATABASE_URL" -c "select event, action from github_events order by received_at desc limit 1"`. |
| S-01-T17 Provide the Anthropic API key | Key anytime; log check after P-05 | 1. Decide the billing owner: pay-per-token on an org Claude Console account, not a subscription; reviewer `claude-opus-5-5` costs $4 / $20 per million input / output tokens. 2. Console → Settings → Workspaces → create `pr-review-agent`. 3. Set a monthly spend limit for the pilot. 4. API keys → Create key in that workspace, name `pr-review-agent-local`. 5. Put it in `.env` as `ANTHROPIC_API_KEY` (never in chat or commits; hosted: the F-04-T6 secret store). 6. Restart `pnpm --filter @pra/worker dev`; the log says `model access configured`. |
| S-01-T18 Real smoke on one WB PR | P-05, S-01-T16, S-01-T17 | 1. `docker compose up -d db && pnpm db:migrate`. 2. `pnpm db:seed-repo packages/db/seeds/workflowbuilder.json --instructions ~/Projects/wb-factory/knowledge` (skip if seeded). 3. Start api, worker, web and the smee client. 4. On WB, mark a small draft PR "Ready for review". 5. Open `http://localhost:5173/prs`, open the PR, wait for round 1. 6. Check the Findings tab, the one GitHub comment, and `select role, model, cost_usd, cost_source, transcript_blob_key from agent_sessions order by id desc limit 1`. 7. Report the cost and anything odd. |
| S-02-T11 Sign the first decision on a real WB PR (north star) | P-08, S-01-T18 | 1. Start the stack as in S-01-T18 steps 1–3. 2. `http://localhost:5173/settings/team`: add yourself (sign as yourself), then the WB PR's author. 3. `/prs`: find the PR in Action needed ("Decide N findings"). 4. Select findings → Implement, Reject (with reason) or Defer → sign. 5. Check the banner, then the lane on `/prs`. 6. `psql "$DATABASE_URL" -c "select decision, signed_by, created_at from decision_batches order by created_at desc limit 1"`; GitHub PR has no new comment. 7. Report. |
| S-20-T9 Connect a real second repository | P-09, S-01-T16 | 1. Create or pick a second repo (private throwaway with one source file is enough). 2. github.com → Settings → Applications → Installed GitHub Apps → `pr-review-agent` → Configure (org: org Settings → GitHub Apps) → Only select repositories → add it → Save. 3. App: Settings → Integrations lists it. 4. Settings → Repositories → Connect a repository → pick it; default level 2, default branch, install command (or empty), ClickUp off → Save and sign. 5. Open a PR there and mark it ready. 6. Within ~10 s the board shows the card; round 1 runs at level 2; GitHub shows "Ready for team member review (round 1)"; Integrations shows the delivery. |
| S-04-T8 Real Checks and judge on a WB PR | P-15 | 1. Start Docker Desktop (Linux host: rootless Docker and `SANDBOX_DOCKER_HOST` in `.env`; macOS: leave unset). 2. GitHub App → Permissions & events: Checks Read-only, Commit statuses Read-only → Save. 3. Org owner: Organization → Settings → GitHub Apps → `pr-review-agent` → accept the permissions request. 4. `.env` still has `ANTHROPIC_API_KEY`. 5. `docker compose up -d db`, `pnpm db:migrate`, start api, worker and web. 6. On an open WB PR: Start review ▾ → level 2 → Start review. 7. Run detail: CI counts equal GitHub's Checks tab, install exit 0, a Change type stage with a judge session and cost. 8. `docker ps -a --filter label=pra.sandbox` lists nothing. 9. Note: macOS proves `--network none` only (S-04-T9 does the rest). |
| S-05-T5 Real verified round on a WB PR | P-13, S-04-T8 | 1. S-04-T8 worked. 2. Start api, worker and web. 3. Open a WB PR → Start review ▾ → level 3 → Start review. 4. Findings tab: each finding is Confirmed, Refuted or Not proven. 5. For one Confirmed finding, open the quoted file on GitHub at the reviewed SHA; the quote is there word for word. 6. Run detail → Verify: note the total cost and report it. 7. `docker ps -a --filter label=pra.sandbox` lists nothing. |
| S-06-T9 Real ClickUp key, WB IDs and smoke | P-19 | 1. Pick the account that owns the key (a shared service account is best) and log in. 2. Avatar → Settings → Apps → API Token → Generate, copy. 3. `.env` `CLICKUP_API_KEY` (never commit). 4. Workspace ID = first number in `app.clickup.com/<id>/…`. 5. Follow-up list → "…" → Copy link; the number after `/li/` is the list ID. 6. Workspace Settings → ClickApps → Custom Task IDs: write the branch/title task ID format as a regex (e.g. `WB-\d+`). 7. App: Settings → Repositories → workflowbuilder → set ClickUp workspace, follow-up list and task ID pattern → Save and sign (before P-23 the seed flags `--clickup-workspace --clickup-list --clickup-task-pattern` also work). 8. Settings → Team: set the ClickUp user for every member, PR authors included. 9. Restart api and worker. 10. Start a round on a WB PR whose branch or title has a task ID; the PR page shows the task, Run detail → Task shows its description. 11. Defer one finding to ClickUp (signed); the follow-up task appears in the list. 12. Give a signed review → Notify author; the task comment mentions the author and names you. Delete the test task and comment if noisy. |
| S-12-T6 WB branch protection, merge permission and a real merge | P-19 | 1. WB → Settings → Branches and Rules → Rulesets: write down the `main` rules (approvals, status checks, restricted pushes, linear history) and report them (OQ3). 2. If pushes to `main` are restricted, add the `pr-review-agent` app to the allow list, never to a bypass list. 3. Settings → General → Pull Requests: "Allow squash merging" on. 4. App permissions: Contents Read and write, Pull requests Read and write (Checks, Commit statuses Read-only); events Check suite, Status, Pull request review → Save. 5. Org owner accepts the permissions request. 6. If WB CI runs on PRs to any branch: base branch `pra-merge-smoke` from `main`, branch `pra-merge-smoke-head` with a one-line docs change, PR into the base; else agree a tiny real PR into `main`. 7. Mark it ready, let round 1 finish, decide findings, approve sensitive files, wait for green CI. 8. Ready to merge → Merge #N… → type the number → pick your name → Merge. 9. GitHub: squash-merged by `pr-review-agent`, message ends `Signed-off-in-app-by: <your name>`. 10. Throwaway route only: add a rule on `pra-merge-smoke` requiring 1 approval, open a second PR, reach Ready to merge without approval, Merge → the dialog shows GitHub's refusal. 11. Delete that rule and the `pra-merge-smoke*` branches. |
| S-13-T8 Implementer smoke on a real PR | P-18, S-01-T17 | 1. `.env` has `ANTHROPIC_API_KEY`; status chip → set the daily budget small (e.g. $10), sign. 2. Start the stack as `AGENTS.md` says. 3. Pick a WB PR with a Confirmed finding (or push branch `pra-smoke-implementer` with one small bug, open a PR, mark ready, level 3+). 4. PR header → level 4; decide one Confirmed finding Implement with "Implement with agent" ticked, sign. 5. Wait for Patch ready; Patch tab shows the diff, "N of M fixed" and the reproduction result. 6. Run detail → implementer transcript: no Bash or shell calls, every edited path inside the repo. 7. Don't push; keep the PR open for S-14-T6. |
| S-14-T6 Real push smoke | P-22, S-13-T8 | 1. App → Permissions & events: Contents and Pull requests Read and write; events Pull request and Push; if changed, Save and accept on the installation. 2. WB → Settings → Branches/Rulesets: only the default branch protected; PR branches accept app pushes. 3. Settings → Team: your GitHub login is set. 4. Open the Patch ready PR → "Push to <branch>…" → type the number → sign → confirm. 5. GitHub: one new commit by `pr-review-agent[bot]`, no force-push event, a `Co-authored-by:` line, no finding text or app address. 6. App: "Round 2 of 3 · started by pr-review-agent after fix <sha>" runs and marks fixes Resolved or Not resolved. 7. Refusal: make a new patch, push any commit to the branch from your machine, click Push → refused "head moved", nothing pushed. 8. Close or delete the smoke PR and branch. |
| S-18-T9 Real ClickUp alert smoke | P-20, S-06-T9 | 1. ClickUp, WB space: create task "PR Review Agent alerts", copy its ID. 2. `.env`: `APP_BASE_URL` = the app address (local: web dev server); `CLICKUP_API_KEY` set; restart api and worker. 3. Settings → Alerts: paste the task ID as the general alerts task, "Cost of one PR" $0.01 → Save, sign. 4. Open a WB PR with a linked task → Start review. 5. Within a minute of the first session cost: one comment on the PR's task naming the problem and next step, linking `<APP_BASE_URL>/pr/...`, ending "pr-review-agent"; the link opens the PR; the card shows the bell. 6. Activity → Dismiss; no new ClickUp comment. 7. Settings → Alerts: threshold back to $5, Save, sign. |
| S-23-T8 Analyst smoke on a real closed PR | P-21, S-01-T17 | 1. `.env` has `ANTHROPIC_API_KEY` (real spend, shown in Run detail). 2. Pick a merged WB PR with decided findings and review comments by someone other than the author. 3. PR page → "Run analyst" (unsigned). 4. When the banner says "Analyst finished: N candidates": Settings → Learning shows at most 5, each linked to the PR. 5. Analyst Run detail: no comment by the PR author in the input; note the cost; Insights → Cost lists it under Analyst. 6. Accept nothing unless wanted; Reject is signed and lands in the Audit log. |
| F-04-T6 Choose host, managed Postgres, bucket and secret store | Anytime | 1. Linux VM where rootless Docker and gVisor run (KVM VM; start 4 vCPU, 8 GB RAM, 80 GB disk), SSH for you only. 2. Same region: managed PostgreSQL 17, daily backups, database and user `pra`, connections from the VM only → secret `DATABASE_URL`. 3. Private S3-compatible bucket, public access blocked, lifecycle delete after 90 days, key limited to the bucket → `S3_BUCKET`, `S3_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`. 4. Secret store (cloud secret manager or 1Password Connect) with `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `CLICKUP_API_KEY`, the S3/AWS names, `SENTRY_DSN`, plus the App key file mounted at `GITHUB_APP_PRIVATE_KEY_PATH`; injected into api and worker only. 5. Report host, Postgres service, bucket provider, secret store and region (no values). |
| F-04-T7 Shared access gate | P-03, F-04-T6 | 1. Pick the gate: shared password page, SSO proxy (oauth2-proxy with Google Workspace, or Cloudflare Access), or VPN (Tailscale). 2. Point DNS at the VM; TLS at the gate or a Caddy in front of `web`. 3. Protect every path except `POST /webhooks/github`. 4. Cookie-based gate: confirm the deployed api has the CSRF guard (F-04-T4). 5. Give the team access. 6. Check: outside the gate `/prs` shows the gate; `curl -i -X POST https://<host>/webhooks/github` returns 401 from the app. Report the gate type. |
| F-04-T8 Sentry project | P-03, F-04-T6 | 1. Sentry → new Node.js project `pr-review-agent`. 2. Store its DSN as `SENTRY_DSN` in the secret store only. 3. Optional: alert rule emailing you on new issues. |
| F-04-T9 First deploy and smoke from inside the gate | F-04-T6–T8 | 1. On the VM: Docker Engine with compose; clone `alek-kowal/pr-review-agent` with a read-only deploy key. 2. Secret store writes the env file and App key file that `deploy/compose.yaml` expects, `chmod 600`, deploy user only. 3. `docker compose -f deploy/compose.yaml build`. 4. `docker compose -f deploy/compose.yaml run --rm migrate`. 5. `docker compose -f deploy/compose.yaml up -d`. 6. Inside the gate open `https://<host>/health` and `/prs`. 7. `docker compose -f deploy/compose.yaml exec api node dist/sentry-test.js`; check Sentry. 8. Report the URL and result. |
| F-04-T10 Point the GitHub App webhook at the host | F-04-T9, S-01-T16 | 1. GitHub → org → Settings → Developer settings → GitHub Apps → `pr-review-agent` → Edit. 2. Webhook URL `https://<host>/webhooks/github`, same secret → Save. 3. Advanced → Recent Deliveries → a `pull_request` delivery → Redeliver. 4. Response 202; on the VM `psql "$DATABASE_URL" -c "select event, action, blob_key from github_events order by received_at desc limit 1"` and the blob exists in the bucket. 5. Stop the local smee client (local dev then needs its own channel). |
| S-04-T9 Re-verify sandbox isolation on the Linux host | S-04-T8, F-04-T9 | 1. On the VM as a dedicated user: `dockerd-rootless-setuptool.sh install`. 2. Install gVisor `runsc`, register it in that daemon's `daemon.json`, restart. 3. Point the worker at the rootless socket (`SANDBOX_DOCKER_HOST`), restart it. 4. Run S-04's isolation test (`pnpm --filter @pra/integrations test sandbox.docker.test.ts`): no network, no env secrets, read-only mount, CPU, memory and time limits. 5. Send the output. |

## Coverage check

Tasks: 202 in packages + 19 Needs Alek + 9 in F-01 = 230, each in exactly one place.

| FR | Package(s) |
| --- | --- |
| FR-001, 002, 077 | P-09 |
| FR-003, 079–081 | P-17 |
| FR-004, 036, 058 | P-04 |
| FR-005, 057 | P-08 |
| FR-006–009, 011–013 | P-24 |
| FR-010 | P-12, P-16, P-20 |
| FR-014, 027, 031 | P-05 |
| FR-015–020, 045, 046, 059 | P-11 |
| FR-021, 074 | P-16 |
| FR-022–024 | P-15 |
| FR-025, 033, 060, 061, 063 | P-10, P-12 |
| FR-026, 047–050 | P-18 (adapter P-06) |
| FR-028 | P-05, P-06, P-09 |
| FR-029 | P-06, P-09, P-12 |
| FR-030 | P-09, P-15 |
| FR-032 | P-06, P-09, P-13 |
| FR-034, 035, 037–039, 041, 043, 044 | P-14 |
| FR-040 | P-07, P-08 |
| FR-042 | P-12 |
| FR-051–053 | P-22 |
| FR-054–056 | P-19 |
| FR-062, 083–086 | P-21 |
| FR-064–068 | P-20 |
| FR-069–071 | P-13 |
| FR-072 | P-13, P-22 |
| FR-073, 076, 087 | P-07 |
| FR-075, 078, 082 | P-23 |
| FR-088 | P-01, P-03, P-05 |

| User story | Package(s) | User story | Package(s) |
| --- | --- | --- | --- |
| US-01 | P-03, P-04, P-05 | US-10 | P-16 |
| US-02 | P-14 | US-11 | P-11 |
| US-03 | P-07, P-08 | US-12 | P-17 |
| US-04 | P-11 | US-13 | P-21 |
| US-05 | P-11, P-19 | US-14 | P-20 |
| US-06 | P-18, P-22 | US-15 | P-13, P-22 |
| US-07 | P-22 | US-16 | P-07, P-09 |
| US-08 | P-11 | US-17 | P-18 |
| US-09 | P-15 | | |

All 88 FRs and 17 user stories map to at least one package.
