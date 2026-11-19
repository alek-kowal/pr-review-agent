---
change_id: P-02
title: Domain core (F-03-T1 to F-03-T14)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-02 from `context/foundation/work-packages.md`: roadmap item F-03
(`domain-core-acceptance-tests`), tasks F-03-T1 to F-03-T14 in
`context/foundation/roadmap-tasks.md#f-03-domain-core-acceptance-tests`. Plan: no; the tasks'
"Done when" checks are the plan. One commit per task.

## Decisions

- **P's test files were not read.** The session brief forbids touching `~/Projects/wb-factory*`,
  and the access classifier blocked a read-only listing. The rules come from the PRD Business
  Logic, `docs/01-analysis.md` §2.4, `docs/03-design-decisions.md`, `docs/05-review-triggers.md`,
  `prototype/js/sim.js`, `prototype/js/data.js` and the task text. Each ported test names the P
  file and line from the task text in its title, so `PORTING.md` can point at it, but which rule
  sits at which P line is inferred. A parity pass against P needs read access (see the handoff
  note in the final report).
- Reason codes: `ReasonParams` is an empty interface that each family fills by declaration
  merging in `src/reasons/<family>.ts`; `Reason<C>` is the discriminated union `{ code, params }`.
  `params` is always present (`{}` when a code has none), matching the API error shape.
  `reason(code, params?)` requires params exactly when the code declares some.
- `reasons.test.ts` declares two test-only codes (`test_plain`, `test_with_path`) by the same
  merging, so the mechanism is tested on its own. They exist only in core's own typecheck (tests
  are not part of any consumer's program).
- Shared entity types live in `src/model.ts` (`Finding`, `Question`, `RoundResult`, `RunRecord`,
  `PrSnapshot`, ...), so builders and every family read one plain shape with no DB types.
  `PrSnapshot` is the `PrStateInput` of F-03-T12.
- `Actor` is `{ kind: 'member', memberId: string } | { kind: 'bot' } | { kind: 'hand' }`. The
  member id is a string so the Team table (P-07) can use any id type.
- Core test files live in `packages/core/test/` (as the task text says); core's `tsconfig.json`
  now includes `src` and `test`, so `@ts-expect-error` type checks run in `pnpm typecheck`.
- `no-copy.test.ts` reads `src` through Vite's `import.meta.glob(..., { query: '?raw' })`, because
  core tests may not import Node APIs (lint). `vite` is a core dev dependency for its client types.
- Empty family test files hold one `it.todo`, because Vitest fails a file with no tests.
- `zod` (^4.6.7, same as `apps/api`) is a core dependency for the F-03-T10 config schemas.
- T2: `needsDecision` gives an unchecked Blocking or Worth fixing finding its own code
  (`unchecked_needs_person`), so "below level 3 every unchecked finding waits" needs no level
  argument. `findingsOutcome` returns every reason in the order a person acts (questions,
  decisions, sensitive files, fixes) and the first one as `reason`.
- T3: `checkQuotes` takes a synchronous reader (`path => string | null`); the worker reads the
  files at the reviewed commit first. Whitespace-insensitive means runs of whitespace collapse to
  one space on both sides. `currentFindings` takes rounds in start order and ignores rounds that
  did not complete.
- T4: the size rule raises a docs-and-tests-only change to Changes behaviour; code outside the
  "uses existing" paths is Changes behaviour by default; one-way paths, then sensitive patterns,
  win over both. `classifyChange` takes `sensitivePatterns` next to `rules`, because RepositoryConfig
  keeps them in their own list (they also drive sensitive-file approval).
- Glob syntax (`src/glob.ts`): gitignore anchoring (a pattern with a `/` at the start or middle is
  rooted, otherwise it matches at any depth; a trailing `/` is a directory), `*`, `?`, `**`,
  `{a,b}` and `(a|b)`. The WB fixture writes the prototype's `**/*.spec.ts(x)` as
  `**/*.spec.{ts,tsx}`, because `(x)` is a required group, not an optional `x`.
- T5: the per-change-type caps (`CHANGE_TYPE_LIMITS`) are built-in defaults, not P's
  `review-profiles.json` (not read): Uses existing 3 findings, 1 question, no nits, no Verify;
  Changes behaviour and One-way door 7 and 3. `limitsFor` takes an optional table so S-04 can
  seed a repository's own caps. A level only narrows (minimum, or severity intersection).
- T6: level names are keys (`diff_only` ... `learning`); the web maps them to copy. Stages and
  features per level are fixed by the PRD table, not settings. Settable per level: `brief`,
  `maxFindings`, `maxQuestions`, `stageTimeoutMinutes`, `autofixMaxPatches` and models per role.
  Built-in values: level 1 sets 4 findings, 0 questions, 30 min, no brief (prototype
  `S.levels`); level 2 sets 7 and 3; level 5 sets 2 automatic patches. A value comes from the
  nearest level at or below `n` that sets it, an override beating the built-in value at the same
  level. Built-in models stay in `DEFAULT_MODELS` (tech-stack.md; analyst `claude-sonnet-5-5`),
  not in a level, so `modelFor` can put AppSettings between level overrides and the defaults.
- `freezeLevel` returns a deep-frozen JSON copy (origins included, so Run detail can show them).
- Fix-check rounds plan `checks`, `fix_diff`, `check_fixes`, `reproductions` (prototype
  `stepsFor('fixcheck')`); only Checks can be off (below level 2).
- T7: `roundStartForEvent` takes a GitHub `pull_request` action and checks, in order: closed,
  `synchronize` (`push_never_starts`), draft (also `converted_to_draft`), other actions
  (`event_ignored`), fork, an active round or implementer run (`run_active`; trials and the
  analyst do not block). Only `opened` (not draft) and `ready_for_review` start round 1.
  `reopened` starts nothing. `chainState` takes runs in start order; a retried run is one record
  that keeps its round number. A round 1 is `newChain` when any earlier round exists.
- Reason codes share one namespace, so codes are unique across families: the round rules own
  `draft`, `fork`, `pr_closed`; the PR state banners and autofix holds use their own codes.
- T8: `planRun({ kind, level, roundKind, roundNumber })` builds a queued run with its stage plan
  (rounds and trials from `stagesFor`; implementer `worktree`, `implement`, `reproductions` from
  the prototype's `stepsFor('fix')`; analyst `analyse`). `completeStage` completes the run when no
  stage is pending. `cancelRun` fails a running stage with `cancelled`. `retryFromStage` puts the
  run back to `queued` (it passes the start gates again), adds one to `attempt`, and records
  `retryFrom`. `recoverAfterRestart` leaves a running run between stages unchanged, because the
  next stage's pg-boss job is durable. Stages must start in plan order (`stage_out_of_order`).
- T9: `autofixDecision` is the start check after a round; `go` ignores the level, so below
  level 5 (`enabled: false`) it says what level 5 would have done (shadow log). Work = findings
  that need a decision plus Implement findings not resolved. Holds, in order: fork, nothing to
  fix, open questions, unsure verdicts, a fix that needs a decision (`remedy` not `obvious`),
  One-way door, new commits since the review (from the prototype's `commitsSince === 0` guard),
  N patches per chain used, paused, budget reached. Conditions 1 to 3 (all fixed, reproductions
  pass, no sensitive file) are checked on the patch by `pushByItself(patch, sensitivePatterns)`.
  Sensitive files the PR itself touches are not an autofix hold (the PRD condition is about the
  patch); they still hold the PR in Action needed through the state table.
- T10: schemas use `zod/v4` like `apps/api`. RepositoryConfig: `slug`, `githubFullName`,
  `defaultBranch` (`main`), `defaultLevel` (1), `installCommand`, `clickupSpace`,
  `sensitivePatterns` (`{ pattern, reason }`), `changeTypeRules` (`usesExistingPaths`,
  `oneWayPaths`, `sizeLines`, default 400) and `largePrLines` (default 1000; the WB fixture uses
  1500). The two line defaults are placeholders until OQ14 and S-04 settle them. AppSettings:
  `paused`, `pausedReason`, `dailyBudgetUsd` (null = no budget), `agentSlots` (2), `models` per
  role, `afterRoundGithubComment` (true). LevelOverrides: one optional patch per level key
  `"1"`..`"6"`, so a broken level falls back on its own.
- `parseWithFallback` falls back per top-level field (a broken nested object falls back whole);
  a non-object input gives the defaults plus `config_not_object`. The warning params are
  `{ field, issue }`, where `issue` is Zod's issue code.
- `validModelName` is this repo's own rule (P's regex at `src/settings.ts:33` was not read): start
  with a letter or digit, then only `A-Z a-z 0-9 . _ : @ [ ] -`, at most 100 characters.
  `modelFor` returns `{ model, source, level }` so Settings can show where a level overrides a
  model (FR-075); an empty or invalid value falls back.
- `holdReason` returns `paused` or `budget_reached`; `autofixDecision` keeps its own
  `autofix_paused` and `autofix_budget_reached`, because codes are unique.
- T11: a proposal is a duplicate when the analyst names the candidate (`duplicateOf`) or the
  titles match case-, whitespace- and end-punctuation-insensitively. Open candidates win over
  accepted, then rejected ones; a repeat of an accepted lesson changes nothing
  (`lesson_already_accepted`). New candidates take `proposal.id`, so the function stays pure. PR
  counts are distinct PRs. `canAccept(candidate, signer?)` checks status, then PRs, then that the
  signer is a Team member, so the UI can call it without a signer to decide whether Accept is
  enabled. `withLesson` appends `## <title>` and the rule, and is idempotent on the heading.
