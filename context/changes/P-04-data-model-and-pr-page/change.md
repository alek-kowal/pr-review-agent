---
change_id: P-04
title: Data model and PR page (S-01-T1 to T3, S-01-T12 to T14)
status: in-progress
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
