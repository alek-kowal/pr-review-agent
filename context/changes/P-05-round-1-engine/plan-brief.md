# Round 1 engine (P-05) — Plan Brief

> Full plan: `context/changes/P-05-round-1-engine/plan.md`

## What & Why

A WB PR that becomes ready for review gets round 1 by itself: the webhook is stored, the worker
creates the run, the review stage runs the reviewer in a worktree, findings land on the PR page,
and the bot posts one sentence on GitHub. This is the S-01 slice check, proven with doubles.

## Starting Point

Tables, queries, core rules, integrations with doubles, the read API and the PR page exist
(P-02 to P-04). Nothing connects them: no webhook route, no event or stage handlers, no review
stage, no comment job, no e2e stack.

## Desired End State

`first-round.spec.ts` drives the whole path with `FakeGitHubGateway`, `FakeAgentRunner` and a
local git repository; later packages extend the engine through registries, not edits.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Webhook dedupe | event row unique on delivery id + deterministic pg-boss job id | redelivery gives one row and one job, even after a failed send |
| Stage job dedupe | queue policy `exclusive`, `singletonKey <runId>:<stage>`, handler no-ops unless it is the next stage | duplicate jobs are harmless |
| Lost sends | repaired at worker start with the restart recovery | no outbox table needed |
| Reviewer cwd | the session dir (brief.md, diff.patch), read dirs worktree + knowledge | P's prompt reads "brief.md and diff.patch in the current directory" |
| Prompt | `prompt-reviewer.md` instruction, built-in fallback as in P | WB's imported prompt works unchanged |
| Session limits | 100 turns, 10 USD per review session (constants) | P had none; the runner requires both |
| Comment | at most once per run (claimed row before posting) | never double-post on a public PR |
| Extension points | one registry file each, `DEFAULT_EXTENSIONS`, overridable in `WorkerDeps` | later packages add a file and a line |
| Test isolation | own database for tests that run pg-boss and for the e2e stack | parallel worktrees and files never share jobs |

## Scope

**In scope:** S-01-T5, T6, T9, T10, T11, T15; P-05 extension points; CI e2e job.

**Out of scope:** other stage executors, cancel, retry, pause, budget, chains, SSE.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Webhook | `POST /webhooks/github` | raw body under Fastify's JSON parser |
| 2. Events | round 1 from `pull_request` | out-of-order deliveries |
| 3. Review stage | reviewer run, enforce limits | git worktree in tests |
| 4. Stage handler | state machine, timeout, recovery | pg-boss expiry, idempotency |
| 5. Comment | one GitHub sentence | double posting |
| 6. E2E | Playwright through the real UI | ports and readiness across worktrees |

**Prerequisites:** Postgres from `docker compose up -d db`.
**Estimated effort:** one session, six commits.

## Open Risks & Assumptions

- The CI e2e job can only be proven after the orchestrator pushes.
- Real GitHub and Anthropic wiring stays with S-01-T16 to T18.
