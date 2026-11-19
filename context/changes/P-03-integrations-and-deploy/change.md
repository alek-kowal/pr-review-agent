---
change_id: P-03
title: Integrations and deploy (S-01-T4, S-01-T7, S-01-T8, F-04-T1 to F-04-T5)
status: planned
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-03 from `context/foundation/work-packages.md`, wave 2: `GitHubGateway`, `GitMirror`
and `AgentRunner` with their test doubles (S-01-T4, T7, T8), then Docker images, the single-VM
Compose file, the S3 BlobStore, the CSRF guard, and Sentry with OpenTelemetry (F-04-T1 to T5).
Plan: yes, see `plan.md` (brief in `plan-brief.md`). One commit per task, in that order.

The planning step ran without questions (orchestrator rule: decide and record). Each decision
below was made while planning or implementing.

## Decisions

See `plan.md` "Key decisions"; implementation-time decisions are appended here as tasks land.

### S-01-T4 GitHubGateway (f06677e)

- msw 3 renamed `onUnhandledRequest` to `onUnhandledFrame`; the github tests use the new name.
- `FakeGitHubGateway`, `signWebhook` and the fixtures live only in `@pra/integrations/testing`.

### S-01-T7 GitMirror (7066feb)

- Every `GitMirror` method takes `fullName` first, because one worker serves many repositories.

### S-01-T8 AgentRunner

- `new ClaudeAgentRunner({ apiKey, query?, now? })` is the seam (`query` replaced in tests);
  `createClaudeAgentRunner(env)` reads `ANTHROPIC_API_KEY`.
- Extra error code `role_not_supported`: a role with no `ROLE_TOOLS` entry fails before a session
  starts (P-06 adds the verifier and implementer entries).
- Two cost guards: our own (sum of streamed usage, deduplicated per assistant message id, times the
  price table; aborts with `costSource: 'computed'`) and the SDK's `maxBudgetUsd`
  (`error_max_budget_usd` maps to `cost_limit_reached` with the reported cost).
- Each session gets a fresh temporary `HOME`, removed afterwards, and `persistSession: false`, so
  nothing from the machine's `~/.claude` reaches the agent and nothing is left behind.
- The output schema goes to the SDK as `z.toJSONSchema` without `$schema`; the answer is parsed
  back with the same Zod schema.
- `FakeAgentRunner` is exported only from the test-only `@pra/agents/testing` subpath.
