---
change_id: P-02
title: Domain core (F-03-T1 to F-03-T14)
status: implemented
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

- **P's test files were not read** (superseded: P-02b read them; see "P-02b parity pass" below).
  The session brief forbids touching `~/Projects/wb-factory*`,
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
- T12: states are snake_case keys (`round_running`, `fix_check_running`, `waiting_for_fix`,
  ...); lanes are `not_reviewed`, `agents_working`, `action_needed`, `ready_to_merge` (null when
  merged or closed). Banner codes are `state_*` and "who usually acts" codes are `who_*`, one per
  banner variant in the PRD table (queued paused, budget or slot; round starting, by hand or
  retrying; patch ready or autofix waiting; sensitive pending or sent back). Tones are semantic
  (`neutral`, `working`, `action`, `failed`, `ready`); the web picks colours.
- `mainAction` is `{ action, signed, optional, disabled, stage }`. Queued for a slot offers
  Cancel (the PRD row covers only paused and budget, which offer Resume). Waiting for the fix
  offers Implement with agent, disabled with `implement_below_level` below level 4 (FR-048).
- Only round and implementer runs set an agents-working state; trial and analyst runs never
  change the PR state (FR-081). The input carries `failedRound` only when the last round failed
  and was not retried or replaced; the state loader (P-04/P-08) decides that.
- `actionNeededOrder` is a comparator over `ACTION_NEEDED_ORDER`.
- `PrSnapshot` arrays that core only reads are `readonly` where tests needed it
  (`SensitiveFiles.files`).
- T13: `checklist(pr)` returns `{ ok, items }`; each item is `{ item, ok, reason }` with keys from
  `CHECKLIST_ITEMS` and `checklist_*` codes for both passing and failing rows, so the web can show
  "all green" and the per-row "why". The review item checks, in the prototype's order: no review
  (or a round running on an unreviewed PR), commits after the review, a running round, the last
  round failed, a fix pushed after the review (`reviewedSha !== headSha` with no new commits).
  Only a running `round` run counts as "a round running"; a queued round passes this item (the
  queued state keeps the checklist red), and trials and the analyst never count. CI: no checks
  fails (`checklist_ci_none`); a failed check wins over a running one (`conclusion: null`).
  `ok` also needs `prState === 'ready_to_merge'`, so a waiting patch or a queued run keeps it red.
- T14: `packages/core/PORTING.md` has one row per P test, sorted by P file and line, with columns
  P test, status (`ported`, `slice`, `not ported`), where and a note. Ported rows were built from
  Vitest's JSON report, so each names the real `file › describe › title`; partial ports ("pure
  part only", the model-name part of `classify.test.ts:273`) and the docs/05 rule change for
  `sync.test.ts` are noted. The four `patch-change` tests have no line numbers in the task text,
  so they are rows "1 of 4" to "4 of 4". The file states that parity with P is unverified.
- No UI was touched, so the package needs `pnpm verify` only, not `pnpm test:e2e`.

## P-02b parity pass

P-02b read every test in `~/Projects/wb-factory/test` and the P source each one calls, and
compared it with the core test `PORTING.md` mapped to it. Most mapped tests covered a different P
test than their tag said; tags and rows now point at the P test with the same behaviour. Where
core differed from P and the PRD and design docs were silent, core now follows P. Where the PRD or
the design docs decide otherwise, ours stays and the row says why. These decisions supersede the
T4, T5, T9, T10 and T11 notes above where they disagree.

### Changed to match P

- Change type (P `classify.ts:211`): sensitive patterns are checked before one-way paths. The
  `sensitive_one_way` params add the pattern's `reason` and the number of matching `files`;
  `path_one_way` adds `files`; `paths_change_behaviour` adds `files` and `total`.
- `needsPerson(changeType, rulesPicked)`: files on a one-way path still need a person when a
  person forces a lower type (`one_way_rules_need_person`), as P keeps `extraGated` whatever tier
  is forced. A forced One-way door also needs a person (PRD "always"), which P did not require.
- Limits (P `defaultProfiles`): `ReviewLimits.verify` is `'all' | 'blocking' | 'none'`; Uses
  existing parts verifies Blocking findings only and allows 0 questions (was 1 question, no
  Verify). `skipVerification(changeType, limits)` returns a per-finding check;
  `verify_off_for_change_type` carries the `scope`. Changes behaviour and One-way door keep 3
  questions (prototype), where P had no cap.
- `parseWithFallback` falls back per field inside nested objects too (change-type rules, models,
  each level's patch); the warning names the path (`changeTypeRules.oneWayPaths`,
  `2.models.reviewer`). A nested value that is not an object still falls back whole.
- `holdReason`: a zero budget never holds (P: 0 means no limit). The schema already stores 0 as
  null with a warning.
- Autofix: `trial` input with the `autofix_trial` hold (FR-081; P held trials). With nothing to
  fix the only reason is `nothing_to_fix`, so the shadow log does not count the PR as held by
  questions. `PatchResult.baseSha` and `pushByItself(patch, { headSha, sensitivePatterns })`
  refuse a patch made on an older head (`head_moved_since_patch`, prd.md:139).
- `withLesson(text, { title, rule, prs }, { placeholder })` writes `From PRs: #1, #2.` under
  the rule and drops the placeholder line (P admin.test.ts:79). File text for agents, English.
- WB fixture (`test/fixtures/wb-config.ts`): sensitive patterns follow P's gate table
  (`packages/(sdk|ui|temporal)/package.json`, root-anchored `/deploy/` and `/.claude/`), and
  `usesExistingPaths` adds P's `composesPaths` (`.mdx`, test directories, JS test files,
  `.changeset/`, `apps/e2e/`). Seeding WB's real settings (S-04) should use the same values.

### Kept, because the PRD or design docs decide otherwise

- No behaviour paths, and the size threshold beats docs-only: FR-002 (prd.md:269) lists only
  Uses existing paths, a size threshold and One-way paths; source-notes.md:219 says Changes
  behaviour is "everything else, and any PR above a size threshold". P's 30-line "composes"
  rule for small code (classify.test.ts:66) is not ported.
- An unchecked or Not proven Blocking or Worth fixing finding needs a decision at every level,
  and a confirmed one waits for a person before going to the author (prd.md:106, FR-040); P sent
  confirmed findings to the author and dropped hypotheses at level 3 and up.
- An unchecked nit stays optional below level 3 (prd.md:106). prd.md:597 OQ11 (should nits be
  decidable at all) is still open; ours, like P, lets a nit decided Implement block.
- A push never starts a review (docs/05:7); only `opened` as ready and `ready_for_review` start
  round 1 (docs/05:9).
- After a restart a run between stages is left as it is (docs/01-analysis.md:403, prd.md:404); P
  failed every running run.
- Models: level override, then settings, then the built-in default (FR-075); no environment
  variable layer.
- Automatic patches are counted per chain, not per PR (docs/05:27). The PR's own sensitive files
  are not an autofix hold (prd.md:500 names the patch); merge still needs the approval.
- Sent-back sensitive files stay pending until the author pushes (FR-046); P moved the PR to the
  author.
- A running run can be cancelled (prd.md:483); P could not.

### Not done, docs silent, low value

- No judge on/off switch: the judge runs whenever the Change type stage is on (level 2 and up).
  S-04 can add one if needed.
- `enforce` reports dropped findings as reason codes per severity, not titles.
- A repeat of an accepted lesson changes nothing (T11); P added the PR to the accepted one.

### Map changes

- Rows 10 (`autofix:104`, verifier output parsing) and 13 (`autofix:196`, ledger) move to slices
  S-05 and S-15; rows 14 (`autofix:213`), 18 (`classify:66`) and 60 (`levels:40`) become not
  ported. Totals: 52 ported, 40 slice, 6 not ported.
- The four `patch-change` rows get their real lines (43, 48, 77, 83).
- No UI was touched, so `pnpm verify` is enough; no `pnpm test:e2e`.
