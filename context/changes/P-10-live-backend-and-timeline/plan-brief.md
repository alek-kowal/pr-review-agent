# Live backend and timeline (P-10) — Plan Brief

> Full plan: `context/changes/P-10-live-backend-and-timeline/plan.md`

## What & Why

The backend half of S-03 (live round progress): the database announces changes, the API streams
them to browsers, a running session's cost and stage are stored turn by turn, and the PR timeline,
state log, Run detail, Activity and status APIs exist for P-12's UI.

## Starting Point

Round 1 runs end to end (P-05) but costs and sessions are written only when a stage ends; nothing
notifies, no timeline or state log exists, and there are no run/timeline/activity/status reads.

## Desired End State

A stage update reaches every SSE client within a second; cost grows per turn and ends at the SDK
total; every writer leaves timeline entries and state changes; the read APIs return them and no
GET route writes.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Notifications | one plpgsql trigger function, row-level `AFTER INSERT OR UPDATE` | identical payloads in one transaction are folded by Postgres |
| Listener | dedicated `pg.Client` per process, backoff reconnect, `onReconnect` | a pool slot is never held; clients can refetch after a gap |
| SSE subscription | lazy, shared, closed with the app | api tests that never stream open no LISTEN connection |
| Live cost | worker decorator over `AgentRunner` creating the session row at start | stage executors stay unchanged; spent money is stored even on timeout |
| Run cost | moved by deltas, live and at the end | `runs.cost_usd` stays the sum of its sessions |
| Entry idempotency | unique `(pull_request_id, source_key)` | PR event hooks and run hooks can retry |
| GitHub actors | `hand` with `params.via = 'github'` | actor kinds stay member/bot/hand; the payload has no sender |
| State log | computed by `recordStateChange` from core `prState`, written only on change | one writer; P-08's loader replaces the private one after merge |
| First logged state | `queued` when the ready webhook starts a round | the run exists before the PR event hooks run; `never_reviewed` is logged only when no round started |
| Comment entry order | after "Round 1 finished" | the comment job is queued by the `runCompleted` hook |
| Signed decision entry test | in packages/db | no decision route exists on this branch (P-08) |
| PR timeline route | `/api/prs/:repo/:number/timeline` | PR routes are keyed by repo and number |
| Instruction versions | `runs.instruction_versions` set at run start | Run detail needs them; review stage (H4) stays untouched |
| Today's spend | UTC day, every session created today | the time zone setting arrives with P-16 |

## Scope

**In scope:** S-03-T1 to T7.

**Out of scope:** web (P-12), reconcile poll (P-15), pause/budget (P-16), chains (P-11).

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Notify | trigger + `listenChanges` | reconnect test timing |
| 2. SSE | `/api/live` | hijacked replies in tests |
| 3. Live cost | session rows per turn, `current_stage` | double counting with the end-of-stage insert |
| 4. Core | round label, stepper, time summary | stepper semantics vs plan |
| 5. Timeline | tables, writers, call sites | state loader duplicates P-08 |
| 6. Run detail | run + transcript APIs | transcript format parsing |
| 7. Reads | timeline, activity, status, read-only check | checksum test on its own DB |

**Prerequisites:** Docker Postgres up. **Estimated effort:** one session, 7 commits.

## Open Risks & Assumptions

- P-08's merge brings a second state loader; swap it in at merge (noted in `change.md`).
- Migration number `0006` may collide with P-08/P-09; the later merge regenerates.
