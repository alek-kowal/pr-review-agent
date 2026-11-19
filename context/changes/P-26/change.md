---
change_id: P-26
title: Change-type judge on OpenRouter (e.g. Jev Router), with Claude fallback and comparison
status: in_progress
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

(filled in as the steps land)
