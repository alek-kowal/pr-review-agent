---
change_id: P-26
title: Change-type judge on OpenRouter (e.g. Jev Router), with Claude fallback and comparison
status: done
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Orchestrator task P-26: let the judge run on an OpenRouter model, chosen per role in Settings →
Models. The default judge stays Claude (`claude-haiku-5-5`). One commit per step.

## Plan

1. **OpenRouter judge.** `@pra/integrations` `OpenRouterClient` (interface) with
   `HttpOpenRouterClient` (fetch, `OPENROUTER_API_KEY`, never in errors or logs) and a double in
   `@pra/integrations/testing`. `@pra/agents` `OpenRouterJudge` sends the same user message as
   `judgeRequest`, `response_format` json_schema from `JudgeAnswerSchema`, `provider:
   { data_collection: 'deny' }`, `usage: { include: true }`; zod-validates the answer
   (`output_invalid`). `judgeWithFallback` picks the judge by model and falls back to Claude.
2. **Model choice.** Core: an OpenRouter model is `openrouter/<vendor>/<model>`, allowed only for
   the judge (`validModelNameFor(role, name)`; Settings → Models, level overrides, run check).
   The Models page offers `openrouter/typesafe/jev-router` for the judge and says when
   `OPENROUTER_API_KEY` is not set.
3. **Traceability.** `agent_sessions` gains `provider` and `answered_model`. The judge session
   records provider, requested and answered model, tokens, latency, cost (OpenRouter's
   `usage.cost`, `reported`). Run detail shows them; OpenRouter cost is shown as spend (no
   "API-equivalent") and counts in the daily budget (it is a session cost like any other).
4. **Failure.** Any OpenRouter failure but a cancel → one Claude judge call (no retry loop). The
   stage output stores `judgeFallback { from, to, reason }`; Run detail shows it.
5. **Comparison.** `pnpm judge:compare --models a,b [--limit N] [--yes]` (worker CLI): inputs from
   stored judge prompts, reference = forced change types; read-only; without `--yes` prints the
   call count only.
6. **Docs.** README, AGENTS.md (one line), work-packages "Needs Alek" row.

## Decisions

- **Fallback model** is core `DEFAULT_MODELS.judge` (`claude-haiku-5-5`), not a separate setting.
- **When it falls back:** any OpenRouter failure except a cancel (HTTP error, timeout, invalid
  answer, missing `OPENROUTER_API_KEY`) makes exactly one Claude judge call; no retry loop. The
  stage output records `judgeFallback { from, to, reason }`.
- **Request:** `provider: { data_collection: 'deny' }` and `usage: { include: true }`; no
  `require_parameters` (it would rule out routers like Jev Router) and no attribution headers
  (`HTTP-Referer`, `X-Title`), so no app or repository name leaves the machine.
- **Cost:** OpenRouter's `usage.cost` when present (`reported`); otherwise the highest list price
  of the answered model (`computed`). OpenRouter cost is shown without "API-equivalent" only in
  the judge session and Run detail judge trace; aggregates (Insights, budget chip) keep their
  label and still count it.
- **Model names:** an OpenRouter model is `openrouter/<vendor>/<model>`, allowed only for the
  judge (core `canUseOpenRouter`); `OPENROUTER_API_KEY` joins core `MODEL_SECRET_ENV_NAMES` so it
  is redacted and never reaches a sandbox.
- **Traceability:** `agent_sessions` gains `provider` and `answered_model` (migration
  `0028_judge_openrouter`).
- **Comparison** (`pnpm judge:compare`) replays the stored prompt blob (`judgeInputFromMessage`),
  never refetches a PR. Reference = the change type a person forced; accuracy = the rules floor
  raised by the model's answer vs the forced type. No fallback in compare (a failed call counts as
  failed). Read-only; without `--yes` it prints the call count only.
- **Docs:** `.env.example`, README (Quick start note and Configuration row), one AGENTS.md line,
  and a "Needs Alek" row in `work-packages.md` (marked as outside the roadmap counts, since P-26
  has no roadmap task).
- **Tests:** doubles only (`@pra/integrations/testing` OpenRouter double); no new e2e spec, the
  existing Models and Run detail specs cover the touched screens.
