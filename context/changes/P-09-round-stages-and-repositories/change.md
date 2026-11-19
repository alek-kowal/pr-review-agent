---
change_id: P-09
title: Round stages and repositories (S-04-T3, S-06-T3, S-04-T5, S-05-T2, S-20-T3, S-20-T6, S-20-T4, S-20-T7, S-20-T8)
status: done
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-09 from `context/foundation/work-packages.md`, wave 4: the Checks, Task, Change type
and Verify stages, and connecting and configuring repositories with integration health in
Settings. Plan: no; the tasks' "Done when" checks are the plan. One commit per task, in the
listed order.

## Decisions

### Across the package

- **`execute-stage.ts` (hot file H1, P-10 in this wave) is not edited.** Stage executors keep
  returning `output`; the two stages that must write domain rows do it themselves, in their own
  transaction, before they return: Task writes `pr_task_links`, Verify writes verdicts on
  `findings` and `finding_verifications` (only while the run is still running, checked under the
  run's lock).
- **`WorkerDeps` gets `judge`, `sandbox` and `clickup`** (`createAnthropicJudge`, `createSandbox`,
  `createClickUpGateway` in `main.ts`; `FakeJudge`, `FakeSandbox`, `FakeClickUpGateway` in
  `test/support.ts` and the e2e stack).
- **One worktree per run, shared by its stages** (`src/stages/worktree.ts`): the first stage that
  needs it checks it out and writes a marker (`sessions/run-<id>/worktree.json`, removed with the
  run's files); later stages reuse it, so Review and Verify see the dependencies Checks
  installed. Review now uses it too. A retried run whose files were removed checks out again
  (without `node_modules` if Checks is reused).

### S-04-T3 (Checks stage)

- `GitHubGateway.getCiStatus(fullName, sha)` reads check runs (paginated, at most 10 pages of
  100) and the combined commit status, and returns counts plus each check's name, source and
  state. A check run that is not completed, or `stale`, is pending; `success`, `neutral` and
  `skipped` pass; any other conclusion fails. Statuses: `success` passes, `failure`/`error` fail.
- Stage output: `ci` (counts and checks) and `install` (`status` ok/failed/skipped, `failedStep`,
  each step's exit code, time-out flag, duration and 4,000-character tail, and `logBlobKey`). The
  whole log of both steps is `runs/<runId>/checks-<attempt>/install.log` in BlobStore.
- A GitHub error without an integration code fails the stage with `github_error` and
  `params.status`; integration errors (`sandbox_not_configured`, `github_app_not_installed`, ...)
  keep their own code.
- The package cache is `<dataDir>/cache/<repository slug>`.
- The run-round test "a stage without an executor fails with `stage_not_available`" now runs
  `executeStage` directly on deps without the Checks executor, since every round stage has one.

### S-06-T3 (Task stage)

- Order: a stored link (from an earlier round or by hand) wins and its task is read again; else
  an id in the branch (`how = branch`), then in the title (`title`), each checked with `getTask`;
  else the search for a task that mentions `https://github.com/<owner>/<name>/pull/<n>`
  (`search`). A new link is stored with `linked_by = bot` and the custom id when the task has one.
- A missing `CLICKUP_API_KEY` is treated like a repository without ClickUp (`not_configured`,
  `params.missing` names what is missing) and the round goes on; `clickup_error` and
  `clickup_auth_failed` fail the stage. A stored link whose task is gone gives `no_task` with
  `linked_task_not_found`.
- Stage output: `{status: 'linked', how, task: {id, customId, name, url, status, description}}`
  (description cut at 20,000 characters) or `{status: 'not_configured' | 'no_task', reason}`.
  Worker reason codes are plain `{code, params}` (like stage errors), not core reason codes.
- The reviewer gets the task through a context provider (`stages/review/task-context.ts`,
  section "ClickUp task"); `taskOfRun`/`taskText` give it to the judge and the verifier.
- `FakeClickUpGateway` got `failNext` and `callsOf`; `@pra/db` got `getTaskLink`,
  `upsertTaskLink` and `succeededStageOutput`.
- `run-round.test.ts` (P-05): the stage-timeout test no longer waits forever when the 180 ms
  timeout fires before the session starts (it hung under parallel load and blocked the file's
  `afterAll`); the lost-job test gets a 30 s timeout like its `settled` wait.

### S-04-T5 (Change type stage, tier limits and large-PR flag)

- Order: the rules (`classifyChange`) set the floor; the judge may raise it, never lower it; a
  type a person forced (`pull_requests.forced_change_type`, set with `setForcedChangeType`) wins.
- The judge is skipped, with `judgeSkipped = {code, params}` in the output, when the type is
  forced (`forced`), the floor is already `one_way_door` (`floor_is_highest`), or the repository
  has no judge prompt or rules file (`judge_instructions_missing`, `params.missing`). A skipped
  judge is not an error; the floor stands.
- A judge that runs and fails fails the stage with its error code; `output_invalid` becomes
  `judge_output_invalid`. The judge session is kept like other stage sessions.
- The result (rules, judge, forced, final type, reason, lines, `largePr`, `largePrLines`) lives
  only in the stage output, read with `succeededStageOutput`/`changeTypeOfRun`; no new `runs`
  columns. `largePr` is `lines > largePrLines` (repository setting; the WB seed uses 1,500).
- Review reads the change type: the brief gets a "Change risk" section, and `limitsFor(type)`
  cuts findings and questions after the reviewer answers. The review output stores
  `changeType` and `dropped: {severity, overLimit, questions}`.
- The T5 work landed as a `wip(...)` commit before `git merge main`; it is finished in a second
  commit instead of a squash, since squashing across the merge would need a rebase.
- The Docker sandbox test file (P-06) gets a 30 s test timeout: one container test timed out at
  5 s under the parallel `pnpm verify` load and passes alone.

### S-05-T2 (Verify stage)

- Verify checks this run's findings only (`findingsOfRun`), one verifier session each; the change
  type's scope (`skipVerification`) leaves the others `unchecked` with its reason.
- Missing `prompt-verifier.md` or `verify-rules.md` fails the stage with
  `verifier_instructions_missing` (`params.missing`): unlike the judge there is no floor to fall
  back on. A verifier session that fails fails the stage with its code; `output_invalid` becomes
  `verifier_output_invalid` (`params.findingId` added). Nothing is written then.
- Each session: 60 turns, 3 USD; the level's stage timeout. The real prompt is captured through a
  small recording `AgentRunner` around `deps.agentRunner`.
- Quotes: core `checkQuotes` per quote against the worktree at the reviewed SHA (paths outside
  the worktree or in `.git` read as missing). Missing quotes are dropped and kept in
  `droppedQuotes`; the kept ones become the finding's evidence. No quote left → Not proven
  (`quote_missing`, or `no_evidence` when none was given).
- Reproduction: the script is written to the worktree root as `.pra-repro-<findingId>-<n>-<uuid>.mjs`
  (the v1 rules run it with `node` from the repository root, so relative imports work), the
  worktree is the only mount, read-only at `/work`; network `none`; 2 CPUs, 2 GB, 512 pids,
  5 minutes; `HOME=/tmp`. The file is removed right after the run. Exit 0/3 decide; any other
  exit or the time limit gets one `repairReproduction` (whose answer replaces the first) and a
  rerun; still broken → Not proven (`repro_broken`, exit `-1` in params for a time-out). A
  script's result beats the verifier's verdict and the quote check; without a script the quote
  check decides. Fork PRs never run scripts.
- Each run's whole output is `runs/<runId>/verify-<attempt>/finding-<id>-repro-<n>.log` in
  BlobStore.
- Storage: `findings.verdict`, `findings.evidence` (kept quotes) and a version bump, plus one
  `finding_verifications` row per finding (verdict, core reason, verifier verdict and words,
  dropped quotes, remedy, deciding script, exit code, time-out, output tail and blob key,
  repaired, sandbox runs), upserted by finding. Written by `saveVerifications` in one transaction
  under the run's lock, only while the run is `running`. The stage output lists every finding
  with all its sandbox runs and `written`.
- "Earlier rounds untouched" holds because only this run's findings are read and written.
- Security (from the commit security review): the PR controls the worktree, so the script file
  gets a random name and is opened with `O_CREAT | O_EXCL | O_NOFOLLOW` (a committed symlink can
  never redirect the write onto the host), and the quote reader resolves `realpath` and refuses
  files outside the worktree.

### S-20-T3 (Repository listing and connect API)

- `GitHubGateway.listAccessibleRepositories()` lists `GET /app/installations` and, with each
  installation's token, `GET /installation/repositories` (at most 10 pages of 100 each), and
  returns `{fullName, installationId, account, defaultBranch, private}` sorted by full name. It
  also fills the installation cache. `FakeGitHubGateway` lists its `installations` with
  `repositoryDetails` over the defaults (`main`, public).
- Routes live under `/api/settings/repositories` (Team stays at `/api/team`). `GET /` returns
  `repositories` (connected, with the full config), `available` (reachable, not connected) and
  `availableError` (`{code, params}`, e.g. `github_not_configured`) so Settings can still list
  what is connected when GitHub is down or not configured.
- `POST /` takes `{fullName, config, signedBy}` where `config` is every RepositoryConfig field
  but `slug` and `githubFullName`: the full name comes from GitHub (its spelling), the slug from
  the repository name (`owner-name` when taken, then `-2`, ...). 404 `repository_not_reachable`,
  409 `repository_already_connected`, 503 `github_not_configured`. The installation id is
  stored on connect.
- `PUT /:id` takes `{config, before?, signedBy}`; slug and full name always stay as stored. The
  settings store (`repositoryStore`, area `repositories`, entity = repository id, value = the
  whole parsed config) locks the row (`lockRepository`). Disconnecting is not in Settings yet.
- Globs are validated in core: `isValidGlob` (no `[...]`, no backslash, no `..` segment,
  balanced `{}`/`()`) refines every pattern in `RepositoryConfigSchema` with the message
  `invalid_glob`. Stored configs with a pattern that is now invalid fall back per field with a
  `config_field_invalid` warning, as before.
- The error plugin passes a zod `refine` message that is a reason code (`invalid_glob`,
  `invalid_task_id_pattern`) as the issue's `code` instead of `custom`.
- "Webhooks pick up a new repository without a restart": the worker already looks the
  repository up on every event. The api test checks the delivery is stored and queued for the new
  repository; `github-event.test.ts` checks the worker then creates its PR row with the same deps.
  There is no reconcile poll yet, so nothing to change there.

### Merge of `main` (P-08 and P-05 review fixes)

- No migration clash (main has 0000–0005; ours are 0006–0007).
- Main stops a stage at the next step after the stage timeout (`signal.throwIfAborted()` after the
  fetch). Our review stage checks its worktree out through `runWorktree`, so the check moved
  there (`WorktreeContext.signal`, optional): every stage that checks out the worktree gets it.
- Main's `executeStage` sends the next stage's job again on a repeated or early job. Two of our
  tests now expect that: the Checks test sees a resent `checks` job next to `task`, and the
  "repeated job" run test sees Verify run (and stop with `verifier_instructions_missing`, as it
  seeds no verifier instructions) instead of `stage_not_available`.

### S-20-T6 (Integrations status API)

- `AppDeps` gains `clickup: ClickUpGateway` (`createClickUpGateway()` in `main.ts`; the api
  test helper and the e2e stack pass a `FakeClickUpGateway`, one instance shared by api and
  worker in the stack). Both gateways expose `missingEnv`; "configured" means it is empty. No
  call is made to GitHub while its env is missing, so "not configured" is never a fake success.
- `GET /api/settings/integrations`: GitHub installations are grouped from
  `listAccessibleRepositories` (id, account, repository count); a listing error is returned as
  `listError {code, params}` next to the rest. Deliveries come from `github_events`
  (`githubDeliveryStats`: the newest row and the count since now − 24 h).
  `lastReconcilePoll` is always null: no reconcile poll exists yet.
- Signature failures are counted in memory (`SignatureFailures`, decorated on the app, bumped on
  the webhook's 401). On purpose: an unauthenticated request never writes to the database. The
  count restarts with the api; the cap is 10 000 entries in the last 24 h.
- ClickUp "last call" is the newest finished Task stage attempt that reached ClickUp
  (`lastClickUpCall`: failed, or succeeded with an output status other than `not_configured`).
  A failed one reports its `errorCode`; there is no separate ClickUp call log.
- `POST /clickup/test` always answers 200 with `{ok: true, user}` or
  `{ok: false, error: {code, params}}` (for example `clickup_auth_failed`,
  `clickup_not_configured` with `missing`): the result of the test is data, not an api error.
  "Error text" in the task means this reason code; the web maps it to copy.
- `PUT /api/settings/integrations` takes `{afterRoundGithubComment, before?, signedBy}` and goes
  through `applySignedSettingsChange` with `integrationsStore` (area `integrations`, entity
  `app`). Its value is only the area's own fields of `app_settings`, so the logged change shows
  just them; the write merges into the locked app settings row.
- The route test uses its own database (`createTestDatabase`): delivery counts and the app
  settings row are global, and other api test files share theirs.

### S-20-T4 (Repository settings pages)

- Routes: `/settings/repositories` (list), `/settings/repositories/connect?fullName=…` (connect
  form) and `/settings/repositories/$id` (edit). Repositories is registered in the Settings page
  registry (group `repositories`).
- The list shows repository, default level ("2 · With context"), ClickUp on/off, sensitive file
  count and default branch. "Open PRs" from the prototype is left out: the api has no such count.
  When the App cannot list repositories (`availableError`, e.g. `github_not_configured`) the list
  still shows, with a status line instead of the picker.
- "Connect a repository" is a Combobox (Popover + Command, like the signature field) of
  `available`; it also hides any name already connected, in case the list is out of date. Picking
  one opens the connect form with the defaults (branch from GitHub, level 1, ClickUp off); one
  signed save posts it and opens the new repository's page (`ignoreBlocker`).
- One form for connect and edit (`RepositoryForm`), sections General, ClickUp, Sensitive files,
  Change-type rules; it covers every RepositoryConfig field, including P-06's fetch and install
  commands and ClickUp ids. ClickUp has an on/off Switch (off sends `clickup: null`); its fields
  show only while on.
- Change-type rules are one editable table of path patterns, each with its rule ("Uses existing
  parts" or "One-way door"), plus the size threshold; the prototype's comma-separated inputs
  became the table the task asks for.
- The form is flattened (`form-model.ts`) so the save dialog has one row per field; sensitive
  files and change-type paths each count as one change. A connect lists every field with an
  empty "Now" and shows the save bar from the start ("Not connected yet", "Connect…": `SaveBar`
  gained optional `message` and `saveLabel`).
- Validation runs in the web on Save (core's `isValidGlob` and `isValidTaskIdPattern`, required
  fields, whole numbers above 0): marked fields block the dialog with a message; a sensitive row
  without a reason says "Each sensitive file pattern needs a reason." The api validates again.
- Added the shadcn `Switch` primitive (`components/ui/switch.tsx`, radix-ui).

### S-20-T7 (Integrations page)

- `/settings/integrations`, registered under General. Three cards (labelled regions): GitHub App,
  "Comment on the PR in GitHub", ClickUp, with the prototype's copy where it has some.
- Status pill per integration: "Connected", "Not configured" (with the missing env var names,
  never values) or, for GitHub, "Not reachable" when listing installations failed. The prototype
  has no not-configured state; this follows the task's rule that missing credentials never look
  like success.
- GitHub shows installations (account · repository count), the repositories it can act on, last
  delivery (time and `event.action`), 24 h deliveries and failed signatures, and "Reconcile poll:
  not running" (no poll exists yet). Repository names are not linked: the status has no ids.
- ClickUp shows its last call (time, answered or the error's copy) and "Test the connection";
  the result shows inline in a status line (ok with the key's user, or the error's copy) instead
  of the prototype's toast, so it stays readable and testable.
- The comment Switch goes through `useSettingsForm`, the save bar (one unsaved change) and the
  signed dialog ("GitHub comment after a round": On → Off).
- Settings → Repositories now links "GitHub App" to this page.

### S-20-T8 (End-to-end second repository)

- `e2e/connect-repo.spec.ts` connects `acme/second-repo` in Settings (level 2, branch `develop`,
  `db/migrations/**` with a reason, ClickUp off, signed by Kasia), delivers `ready_for_review` for
  `acme/second-repo#12` and checks the board card with its repository, the PR page ("Unchecked
  (level 2)"), the round's stages from `GET /api/prs/second-repo/12` (Verify `off`), the change
  type and Settings → Integrations.
- The stack's GitHub double also reaches `acme/second-repo` (installation `55500002`,
  `SECOND_REPOSITORY` in `e2e/support/env.ts`); no seed connects it. `deliverPullRequest` takes an
  optional repository, which it writes into the payload's repository, head and base repos and
  installation.
- The stack's fixture PR also adds `db/migrations/0001_edge_labels.sql`. "Applies to that
  repository only" is shown through the Change type stage, the one place a sensitive pattern acts
  today (approval comes with S-11): the second repository's round is a One-way door with
  `sensitive_one_way`, and Workflow Builder keeps "0 patterns". It also lets the round finish
  without a scripted judge (the floor is already the highest).
- Kasia signs. The spec inserts her with the same name and GitHub login decide.spec.ts uses,
  with `on conflict do nothing`, so the two specs never disagree about Team when they run in
  parallel.
- `e2e/a11y-routes.ts` does not exist yet (its a11y spec comes with a later package). When it is
  created, add `/settings/repositories`, `/settings/repositories/connect`,
  `/settings/repositories/$id` and `/settings/integrations`.

### Merge of `main` (P-10 live backend and timeline, P-06f stable sandbox tests)

- Migrations: main's `0006_live_notify`, `0007_run_current_stage` and `0008_timeline` stay as they
  are. Our `0006_forced_change_type` and `0007_finding_verifications` (SQL and snapshots) were
  deleted and generated again on top with `pnpm db:generate --name …`, one at a time (the
  `finding_verifications` table was taken out of the schema for the first run), so they are now
  `0009_forced_change_type` and `0010_finding_verifications`. Their SQL is byte-for-byte the old
  SQL. The note in the earlier merge ("ours are 0006–0007") no longer holds.
- `app.ts`: `AppDeps` keeps both `clickup` (ours, Settings → Integrations) and `live?` (main, SSE
  hub); both go into `deps`, and `signatureFailures` stays decorated.
- `queries/index.ts`: exports both sides' modules (`timeline.ts` from main next to ours).
- `sandbox.docker.test.ts`: main's version. Our only change there was a stopgap 30 s `describe`
  timeout; P-06f's `ONE_RUN_PER_TEST` (run limit plus 15 s) solves the same flakiness.
- `routeTree.gen.ts`: regenerated with `vite build`, not hand-merged; it adds our four
  `settings.repositories.*`/`settings.integrations` routes to main's tree.
- P-10's stepper and `runs.current_stage` work from `stagesFor(level)` and the stage key, so our
  Checks, Task, Change type and Verify stages show in the live stepper with no extra code.
