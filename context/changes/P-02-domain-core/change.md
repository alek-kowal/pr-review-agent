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
