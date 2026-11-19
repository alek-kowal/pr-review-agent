---
change_id: P-23
title: Models, levels and audit log (S-21-T1–T8, S-20-T5)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-23 from `context/foundation/work-packages.md`, wave 8. Plan: no; the tasks'
"Done when" checks are the plan. One commit per task, in the listed order.

## Decisions

### S-21-T1 (level and model settings in core and db)

- Core already had the ladder, inheritance (`resolveLevel`), `DEFAULT_MODELS` and the model-name
  check from P-02. `resolveLevelSettings(n, overrides, roleModels)` (new `level-settings.ts`)
  builds on `resolveLevel` and adds what Settings needs: what the level adds, its own values,
  origins and every role's model (`RunModels`). `levelModelOverrides` feeds the Models page note.
- Storage follows the task: tables `level_settings` (level 1–6, own values as jsonb) and
  `model_settings` (role, model). The migration adds the six empty level rows and the five default
  models (a model already in `app_settings.models` moves over), then drops `models` from
  `app_settings`. The hand-written inserts sit at the end of `0014_level_model_settings.sql`; if
  the migration is regenerated after a merge, copy them back.
- The global default level lives in `app_settings.defaultLevel` (default 1). The repository's
  `defaultLevel` is now nullable (null = global default); `prLevel` takes the global default, and
  the PR view's `repositoryDefault` is the effective default. Settings → Repositories offers
  "Global default" in the level Select; a newly connected repository starts with it.
- `modelFor` no longer skips a set but invalid name: the run that would use it fails before any
  spend (`model_invalid`, S-21-T2) instead of quietly running another model.
- Tests that write level or model settings use their own database (the tables are global).

### S-21-T2 (worker snapshots the settings per run)

- The snapshot is taken in `createRun` (in `@pra/db`, where every run is created), not when the
  first stage starts: the level was already frozen there. `runs.level` now carries the level
  overrides; the new `runs.models` column holds every role's `ModelChoice`. Stages read
  `runModel(run, role)` instead of the live app settings, so a running run keeps its models.
- An invalid snapshot model fails the run's first stage with `model_invalid` (`runExecutor`,
  before any executor or session), so nothing is spent.
- Run detail: the API returns `run.models` (role, model, source, level) and the page shows a
  "Models" side card. Runs from before the snapshot show their level override or the default.
- The level 5 patch cap is in the snapshot (`level.settings.autofixMaxPatches`); `autofixDecision`
  has no caller on this branch, so P-22 (or the merge, if P-22 lands first) wires it.

### S-21-T3 (models and levels API)

- Audit areas and entities: `models` / `roles` (all five roles in one change, so before/after
  hold the whole map and a search for a role name finds it); `levels` / `"1"`…`"6"` (the level's
  own values); `levels` / `default` (`{ defaultLevel }`).
- `PUT /api/settings/levels/:n` takes `{ values, before?, signedBy? }`. `values` is the level's
  complete set of own values: a field left out or sent as `"inherit"` is inherited. Models per
  role sit in `values.models` the same way.
- `autofixMaxPatches` may be set only from level 5 (400 `invalid_request`, issue code
  `not_at_this_level`); lower levels have no autofix.
- Validation errors are the API's usual 400 `invalid_request` with `issues[].path` naming the
  field (`/models/verifier`, `/values/maxFindings`); a bad model name in Settings → Models has
  issue code `invalid_model_name`.
- `GET /api/settings/models` also returns the defaults (for the Select) and the levels that
  override a role (for the note). `GET /api/settings/levels[/:n]` returns each level's own values,
  resolved settings, origins and models, plus the global default level.
- `reads-never-write.test.ts` got a 30 s timeout: it calls every GET route and checksums every
  table twice, which passed 5 s under parallel load.

### Merge of main (before S-21-T4)

- `git merge main` (P-11r) merged cleanly: no new migration on main, P-22 not landed yet, so the
  level 5 patch cap wiring stays with P-22.

### S-21-T4 (Models page)

- Each role's model is a Select of the distinct default models (the role's own default marked
  "(default)") plus "Other model…", which shows a text Input for any name. The name is checked
  with core `validModelName` as it is typed; Save with an invalid name shows a summary alert and
  never opens the signed dialog.
- The override note is plain text ("Level 6 uses claude-opus-5-5") until the level pages exist;
  S-21-T5 turns each note into a link to its level.
- Settings now opens on Models: the index redirects to the first page of the sidebar, and Models
  comes before Team in the approved order. `TeamPage.test.tsx` and `settings-team.spec.ts` open
  `/settings/team` directly.

### S-21-T5 (Review levels pages)

- Routes `/settings/review-levels` (ladder and default level) and `/settings/review-levels/$level`.
  The Models page's override notes now link to their level.
- The level page computes what a value would be without the level's own value in the browser,
  with core `resolveLevelSettings` over the other levels' own values and the role models (from
  `GET /api/settings/models`). So Override starts from the inherited value and Inherited shows it
  again without a round trip, and the source reads "from level 3" or "built in at level 2".
- Every setting and every role's model has the ToggleGroup Inherited / Own value; a reviewer brief
  left empty as an own value saves as `null` (no brief at this level). Numbers are checked with
  core `LevelSettingsPatchSchema` before Save; an invalid value blocks the signed dialog.
- The save sends the level's complete own values (`inherit` for the rest) and the stored own
  values as `before`. N goes in only from level 5 (lower levels have no autofix).
- The autofix rules show on level 5 (N editable) and level 6 (N as text, inherited from 5).

### S-21-T6 (Audit log API)

- `GET /api/audit` reads `settings_changes` only (still the one audit log) through
  `searchSettingsChanges` and `settingsChangeFacets` in `@pra/db`.
- `q` is a case-insensitive substring search over the area, entity, actor kind, signer name, note
  and the before/after JSON as text, so "verifier" finds a model change by its role key. LIKE
  wildcards in `q` match themselves.
- `actor` is `bot`, `hand` or a member id; `from` is inclusive and `to` exclusive, both ISO
  instants (the page turns local dates into instants, so days follow the viewer's time zone).
- Pagination is keyset on `(at, id)`, newest first. `cursor` is the last row's id; the next page
  compares against that row's stored `at`, so microsecond timestamps and rows written while paging
  never shift a page. `limit` defaults to 50 (max 200).
- The response also carries every area in the log and every signer (name kept after they leave
  Team) for the page's filters.

### S-21-T7 (Audit log page)

- Route `/settings/audit` with search params `q`, `area`, `who` (`bot`, `hand` or a member id)
  and `from`/`to` (local `YYYY-MM-DD`, both days included). The page turns the days into the
  API's instants at local midnight (`to` = the next midnight). The search text reaches the URL
  300 ms after the last key; Select and date changes go at once (`replace`, no history spam).
- The "Who" Select lists the signers in the log, then Bot and By hand; the "Area" Select lists the
  areas in the log by their Settings page name (an unknown area shows as stored).
- The summary is derived from before/after: "Added <entity>", "Removed <entity>", or "Changed"
  with the top-level keys that differ (first three, then "and N more"). A row expands to the full
  before and after as formatted JSON.
- Pages of 50 with "Load more" (an infinite query over `nextCursor`).

### S-21-T8 (end-to-end models, levels and audit)

- The e2e stack seeds `GLOBAL_LEVEL_REPOSITORY` without a level of its own (no other spec uses
  it), so the spec's default level 2 changes nothing for specs running beside it. The level 3
  timeout it sets (45 min) is longer than the default 30, so it cannot time out another spec.
- The agent double appends every session's role, model and dirs to `StackState.agentCalls`
  (JSON lines). The spec matches the verifier sessions of its run by the run's worktree dir
  (`run-<id>`), so it checks the model the double received, not only the snapshot.
- Settings are global and a retry would start from the last attempt, so the spec first puts the
  models, level 3 and the default level back through the API when they differ.
- `e2e/a11y-routes.ts` is created with the four new Settings routes only; S-17-T9 (P-24) owns the
  a11y spec and the rest of the list. If P-24 also creates the file, keep both lists.
