---
change_id: P-25
title: Agents on a Claude subscription (CLAUDE_CODE_OAUTH_TOKEN), usage-limit pause
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Orchestrator task P-25: run the agents on Alek's Claude subscription; the API key stays the
second option. Plan: brief, below. One commit per step.

## Plan

1. **Auth.** Core `modelAuthModeOf(env)` (names only): `CLAUDE_CODE_OAUTH_TOKEN` wins, then
   `ANTHROPIC_API_KEY`, else `none`. `@pra/agents` `modelAccessFrom(env)` picks the one secret;
   `ClaudeAgentRunner` passes only that name to the SDK process. The judge and the analyst (the
   only `@anthropic-ai/sdk` callers) run through the Agent SDK in subscription mode
   (`AgentSdkMessages`: one query, no tools, structured output). The docker CLI env drops both
   names. Worker log says the mode.
2. **Visible mode.** `GET /api/status` gains `modelAuth`; the status chip and Settings → Budget &
   status show "Claude subscription", "API key" or "Not configured".
3. **Cost.** In subscription mode every cost the user sees reads "API-equivalent"; the daily
   budget guards that number.
4. **Usage limit.** The runner maps the SDK's usage-limit signals to `usage_limit_reached`
   `{ resetsAt }`. The worker stores one hold (`agent_usage_limit`), parks the stage (no failed
   attempt, no new attempt number), sets the run's wait reason and sends a delayed drain for just
   after the reset. The queue gates hold every other run until then. The PR view shows "Paused
   until <time>: Claude usage limit".
5. **Docs.** README, AGENTS.md (Environment line), work-packages S-01-T17.
6. **Tests.** Unit (auth, env, mapping, pause and resume) and one e2e.

## Decisions

- **Mode selection** lives in core (`modelAuthModeOf`, names only, a blank value counts as unset)
  so the api, the worker and the web agree; `@pra/agents` `modelAccessOf` adds the one secret.
  Adapters take `{ oauthToken, apiKey }`, which mirror the two env vars, so the API-key tests
  stay as they were.
- **The SDK env is replaced, not merged**: the active mode's one name, `PATH` and a temporary
  `HOME`. With both set, only `CLAUDE_CODE_OAUTH_TOKEN` is passed, so a key never takes
  precedence. Error details that are stored have the active secret replaced (`withoutSecret`).
- **Direct API callers** (`grep @anthropic-ai/sdk`): only `AnthropicJudge` and
  `AnthropicAnalyst` (plus the test double `fake-judge.ts`, types only). A Client SDK call cannot
  use a subscription token, so on a subscription both run through `AgentSdkMessages`: one Agent
  SDK query with `tools: []`, no settings or MCP, `maxTurns: 3` (the structured-output answer and
  one retry of it), the same JSON schema, a throwaway `HOME` as `cwd` and only the token in the
  env. It answers in the Messages API shape, so both adapters and their cost math stay
  unchanged. On an API key they keep `@anthropic-ai/sdk`.
- **Sandbox**: the container already got only its spec's env. The docker CLI used to inherit the
  worker's whole env; it now runs with `extendEnv: false` and the worker's env minus every secret
  name (`isSecretName`, the same pattern the log redaction uses).
- **Visible mode**: the api and the worker get the mode in their deps from their composition
  roots (`modelAuthModeOf(process.env)`; both read the same `.env`), default `none`.
  `GET /api/status` answers `modelAuth`; the chip's popover and Settings → Budget & status (the
  page with the daily budget) show "Model access: Claude subscription / API key / Not
  configured", the latter with a one-line hint naming the env var.
- **Cost wording** (steps 2 and 3 share one commit: the same copy files and status type). On a
  subscription every amount reads `$1.23 API-equivalent`; a pair is labelled once (`$1.20 of
  $10.00 API-equivalent`). The hints that said "Real spend" or "billed" say what the number is.
  Chart ticks stay bare (the tooltip carries the label). The web's formatters read a module-level
  cost basis that `RootLayout` sets from the status query before it renders any page; the page
  is keyed by the basis, so a mode change re-renders every amount. The ClickUp alert comment
  gets the same label (`alertCommentText({ apiEquivalent })`, worker `deps.modelAuth`). The
  daily budget, alerts and Insights keep working on the same number, so the budget is a usage
  guard on the API-equivalent cost. API mode reads exactly as before.
- **E2E stack mode**: the shared e2e api runs without a mode (`none`), so the 40-odd cost
  assertions of other specs stay valid; the P-25 spec answers `/api/status` with
  `modelAuth: 'subscription'` through Playwright's `page.route` (a test double in `e2e/` only).
- **How the SDK reports a usage limit** (SDK 0.3.328 `sdk.d.ts`): a `rate_limit_event` message
  with `rate_limit_info.status: 'rejected'`, `resetsAt` (Unix seconds) and `rateLimitType`
  (`five_hour`, `seven_day`, ...); the assistant message carries `error: 'rate_limit'` and text
  that starts with one of `USAGE_LIMIT_ERROR_PREFIXES` ("You've hit your limit · resets ...");
  the result is `subtype: 'success'` with `is_error: true` (`api_error_status` 429). The old CLI
  text "Claude AI usage limit reached|<unix seconds>" is parsed too.
- **A usage limit is** a session that ended in error and either saw a rejected
  `rate_limit_event` or has usage-limit text. A bare `rate_limit` error (a per-minute 429 on an
  API key, after the SDK's own retries) stays `agent_failed`.
