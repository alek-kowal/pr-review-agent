---
change_id: P-04
title: Data model and PR page (S-01-T1 to T3, S-01-T12 to T14)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-04 from `context/foundation/work-packages.md`: roadmap item S-01
(`first-review-round`), tasks S-01-T1, T2, T3, T12, T13 and T14 in
`context/foundation/roadmap-tasks.md#s-01-first-review-round`. Plan: no; the tasks' "Done when"
checks are the plan. One commit per task.

## Decisions

- Ids are `integer generated always as identity`, as in F-02's `smoke` table. Enumerations are
  `text` columns with a Drizzle `enum` type and a `check` constraint, not Postgres enums, so later
  packages add a value with a plain migration and no `alter type`.
- `repositories.config` holds the whole core `RepositoryConfig`; `slug` and `github_full_name` are
  copied from it into their own unique columns. Writes go through `parseRepositoryConfig` (throws
  `RepositoryConfigInvalidError`, code `repository_config_invalid`); reads go through
  `readRepositoryConfig` (`parseWithFallback`, so one broken field falls back with a warning).
  `getRepositoryByFullName` compares case-insensitively (GitHub names are).
- `pull_requests.opened_at` and `updated_at` are GitHub's dates. `upsertPullRequest` writes only
  when a field differs (`on conflict ... do update ... where (...) is distinct from (...)`) and
  returns `{ created, changed }`, so S-01-T6 can leave an unchanged PR alone.
- `recordGithubEvent` is `on conflict (delivery_id) do nothing` and returns the stored row with
  `created: false` on a redelivery, which S-01-T5 needs for "202, still one row and one job".
- `app_settings` is one row with `id = 1` (check constraint). `getAppSettings` reads a missing row
  as the defaults; `ensureAppSettings` inserts them once.
- `instruction_versions`: a unique constraint `NULLS NOT DISTINCT` on (scope, repository, file,
  version), a partial unique index allowing one `active` version per file (`coalesce` on the
  nullable repository id), and a check that global rows have no repository and repository rows
  have one. `importInstructionV1` never overwrites an existing version 1; newer content is S-22's
  job (a new version), not the seed's.
- `pnpm db:migrate` was checked twice on a throwaway database (`create database`, migrate, migrate,
  `drop`), never on the shared `pra` database, so other worktrees' dev data and migrations are
  untouched.
- T2: `runs.started_by` is the core actor kind (`bot`, `hand`, `member`) and
  `started_by_member_id` a text id (core `Actor.memberId` is a string; P-07's Team table adds the
  foreign key if it wants one). A check requires the id exactly for `member`.
- T2: the "one active run per PR" partial unique index (`runs_one_active_per_pr`) covers queued
  and running runs of kind `round` and `implementer` only, because core's round rules say trials
  and the analyst never block a PR (F-03-T7). So P-17 and P-21 need no index change.
- T2: `round_kind` is not stored: round 1 of a chain is a full review, rounds 2 and 3 are fix
  checks (core), so it follows from `round_no`. `runs.trigger` is free text holding a reason code.
- T2: money is `numeric(12, 6)` read as a JS number (Drizzle `mode: 'number'`); GitHub comment ids
  are `bigint` (they pass 2^31). `questions` also keep `ordinal` and the reviewer's `why`, as in
  P's `reviewSchema`; `recommended` is an index into `options`.
- T2: `isUniqueViolation(error, constraint?)` looks through Drizzle's `DrizzleQueryError` to the
  pg error, so the worker can tell "a run is already active" from other failures.
- `@pra/db/testing` exports row builders (`aRepositoryConfig`, `aPullRequest`, `aRun`,
  `aFinding`, `aQuestion`, `seedPullRequest`) with unique slugs, because test files share one
  database per run.
- T3: the seed file is `{ repository, instructions: { global, repository } }`. Which files of the
  instructions folder become global or repository version 1 is data in the seed (WB: reviewer
  prompt and rules global, `lessons.md` and `feature-map/` per repository, OQ15), so no WB file
  name sits in code. An entry ending in `/` takes every file under the folder (recursive, dot
  files skipped); file keys are `/`-separated paths. A listed file that is missing fails the
  whole seed (`instruction_file_missing`) inside one transaction, so nothing half-seeded remains.
- T3: WB's `largePrLines` is left at the core default (1000): the prototype has no value for it
  (core's test fixture uses 1500 only as a test value). `defaultLevel: 1` as the task says.
- T3: relative paths given to `pnpm db:seed-repo` resolve from where pnpm was called (`INIT_CWD`).
  Checked on a throwaway database against the real `~/Projects/wb-factory/knowledge` (read only):
  14 files imported as version 1, a second run imported 0 and kept 14.
- `AGENTS.md` (hot file H14) gains one command line for the seed: about 40 more tokens in every
  agent session.
- T12 (extension point): `GET /api/prs/:repo/:number` is built from PR view sections
  (`apps/api/src/pr-view/`). A section is `defineSection({ key, schema, build(ctx) })`, reads only,
  and gets `{ db, repository, pullRequest }`; `PR_VIEW_SECTIONS` in `pr-view/index.ts` lists them
  and the response schema is composed from them (one top-level key per section, duplicate keys
  throw at start). P-04 registers `pullRequest` and `latestRound`; later packages add a file and
  one line.
- T12: "latest round" means the newest run of kind `round` (by `created_at`, then id), whatever
  its status; the findings endpoint reads the newest *completed* round. Stages come from core
  `stagesFor(level, full|fix_check)` overlaid with each stage's latest attempt, so a stage the
  level turns off shows `off` with its `off_at_level` reason even if the worker wrote no row.
  A failed round carries `error: { stage, code }` from its failed stage, which the web turns into
  the "Round N failed at <stage>: <reason>" line.
- T12: routes live in `apps/api/src/routes/api/{prs,repositories}/index.ts` (autoload prefixes
  `/api/prs`, `/api/repositories`). Timestamps are ISO strings. `?repo=` with an unknown slug gives
  404 `repository_not_found` (not an empty list), an unknown PR 404 `pr_not_found` with the
  params, and a non-numeric number 400 `invalid_request`. `ApiErrorSchema` and `sendError` were
  added to the errors plugin so 404s appear in the OpenAPI document.
- T12: "reads never write" is proved twice: the api under test runs on a session with
  `default_transaction_read_only=on` (so any write would fail the request; the test also checks
  that the session refuses an update), and row counts of the file's own repositories are equal
  before and after every GET (whole-table counts would race with other test files).
- T12: the web cannot import `@pra/api`, so it keeps its own TypeScript types for these responses
  (`apps/web/src/lib/api-types.ts`, T13); the Zod schemas in the api stay the source of truth.
- T13: `apps/web/src/lib/api.ts` sends `X-PRA-Request: 1` on every request, GET included (the
  guard ignores reads; one rule is simpler). An answer `{ error: { code, params } }` becomes an
  `ApiError` with that code; an error without one becomes `http_error`, no answer `network_error`.
  `lib/reasons.ts` maps codes to copy (`reasonText` for "failed at" reasons, `errorText` for
  whole-sentence api errors); an unknown code still shows the code.
- T13 (extension point): the PR tab registry is `PR_TABS` in `apps/web/src/features/pr/tabs.ts`.
  An entry is `{ key, label, Panel }`; the key is the `?tab=` value, the first entry is the default
  and every panel gets `{ repo, number, view }` (the PR view). A package adds a tab with one line.
- T13: TanStack Router hands the raw URL search to child routes, so `validateSearch` returns
  `{ tab: undefined }` / `{ repo: undefined }` for an invalid value instead of `{}`; otherwise
  `?tab=nope` reached the page and no tab was selected.
- T13: polling (until S-03's SSE): the list refetches every 5 s while any listed PR has a queued
  or running round, the PR view while its latest round is, and the findings tab while the round is
  active and once more when it ends (findings come from the latest *completed* round).
- T13: web test helpers live in `apps/web/src/test/`: `fetchStub.ts` (a path table; a path left
  out answers 404 `not_stubbed`, so a test sees what it forgot) and `fixtures.ts` (response
  builders). `setup.ts` adds the jsdom polyfills Radix Select and Tabs need. `tabsListVariants` is
  no longer exported from the shadcn `tabs.tsx` (react-refresh lint; nothing used it).
- T13: `e2e/smoke.spec.ts` answers `/api/repositories` and `/api/prs` with `page.route`, so it
  never reaches an api on :3000 that another worktree may be running. `playwright.config.ts` (hot
  file H13, P-03's in this wave) still uses the fixed port 5173 with `reuseExistingServer`, which
  is not safe when two worktrees run e2e at once; left for H13's owners. P-04 checked the port was
  free before each e2e run.
- T13: `noUnusedLocals` applies when the web compiles `@pra/core`, so the unused
  `import type { NoParams }` lines were removed from nine `packages/core/src/reasons/*.ts` files
  (no behaviour change; core tests green). `@pra/core` is a dependency of web, api and db;
  `@testing-library/user-event` is a web dev dependency.
- T14: groups follow core `SEVERITIES` (Blocking, Worth fixing, Nits; one finding is "Nit", as in
  the prototype). Inside a group refuted findings go last, otherwise the reviewer's order.
- T14: findings start closed, as in the prototype. The line shows severity, title, `file:line`
  (just the file when the line is null), the line slots and the verdict; a click opens scenario,
  suggestion, the "Unchecked (level N)" box or the evidence quotes, then the action slots.
  "Expand all" opens every shown finding. Open findings reset when a newer round arrives.
- T14: the verdict is grey text with an icon and a hover hint, never a badge (FR-036). The level
  in "Unchecked (level N)" is the level of the round the findings come from, not of a newer round.
- T14 (extension point): `FINDING_LINE_SLOTS` and `FINDING_ACTION_SLOTS` in
  `apps/web/src/features/findings/slots.ts`. A slot is `{ key, Component }` and gets
  `{ finding, round, repo, number, view }`; line slots render before the verdict (decision and
  fix-result badges, opinions), action slots at the bottom of an open finding (forms, actions).
- T14: the api has no reproduction result yet (no column in `findings`); the package that adds
  the verifier's reproductions adds the field and a block next to the evidence in `Finding.tsx`.
  Scenario and suggestion are plain text with their line breaks; there is no Markdown renderer yet.
- T14: the filter shows from 7 findings (`FILTER_FROM`) with the prototype's All, To decide and
  Decided. `filters.ts` holds the rules: "to decide" is not a nit and not refuted, "decided" is
  always false until P-08 adds decisions and changes both rules there. The filter is local state.
- T14: the "Not checked" section appears below the findings only when the round lists something.
  When the latest round failed, a red line "Round N failed at <stage>: <reason>" sits above the
  findings of the latest completed round (or above the empty state when there is none). Empty
  states: no findings yet (plus a hint for drafts), "appear when the round finishes" while a
  round runs, "No findings in round N" for a clean round.
- T14: checked visually once with a throwaway Playwright spec that routed the api (not
  committed): severity groups, the open finding with evidence, the failed-round line.

## For the merge

- Migrations `0001_repositories` and `0002_runs`: if another package landed a migration first,
  delete them and run `pnpm db:generate` again after the rebase (work-packages rule). Check
  migrations and the seed only on a throwaway database, never the shared `pra`.
- `playwright.config.ts` still uses the fixed port 5173 (see T13); worth a fix by H13's owner.
