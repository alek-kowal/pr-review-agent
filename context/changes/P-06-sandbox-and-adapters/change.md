---
change_id: P-06
title: Sandbox and adapters (S-04-T1, S-04-T2, S-04-T4, S-05-T1, S-06-T1, S-06-T2, S-13-T1)
status: in_progress
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-06 from `context/foundation/work-packages.md`, wave 3: the sandbox and the offline
install, the judge, verifier and implementer adapters, the ClickUp gateway, task-ID matching and
the repository ClickUp settings. Adapters only; the stages come in P-09 and P-18. Plan: yes, see
`plan.md`. One commit per task, in the listed order.

The planning step ran without questions (orchestrator rule: decide and record).

## Decisions

### Planning

- **Sandbox through the `docker` CLI** (`execa`), not a Docker API client: no new dependency, and
  the same CLI the isolation re-check (S-04-T9) uses. `SANDBOX_DOCKER_HOST` becomes `DOCKER_HOST`
  for the CLI process only.
- **Abort rejects, timeout resolves.** A timeout is a result (`timedOut: true`, `exitCode: null`);
  an aborted signal removes the container and rejects with `sandbox_cancelled`, because the caller
  (a cancelled run) wants no result.
- **Output**: the last 1 MB is kept as `output` (for the BlobStore log) and the last 4,000
  characters as `outputTail` (stage output), so a noisy install cannot exhaust worker memory.
- **Container user** is the worker's own uid:gid (non-root inside the container, owns the mounted
  worktree on rootful Linux and Docker Desktop). Rootless Docker maps uids differently; S-04-T9
  re-checks this on the Linux host.
- **Fetch step needs a writable worktree**: `pnpm fetch` writes the virtual store into
  `node_modules` (checked by hand: `ERR_PNPM_EROFS` with a read-only worktree). It still runs no PR
  code (`--ignore-scripts`) and gets no credentials. The shared per-repository cache (pnpm store,
  corepack) is writable only in the fetch step and read-only in the install step, which has no
  network.
- **WB fetch command adds `--ignore-pnpmfile`**: a `.pnpmfile.cjs` is PR code, and the fetch step
  has network. With a frozen lockfile the hooks are not needed. Overrides the task text.
- **No custom image**: `node:24-slim` with corepack; the package manager comes from the repo's
  `packageManager` field into the cache's `COREPACK_HOME`. Corepack refuses custom URLs by default.
- **Judge and verifier keep the v1 instruction vocabulary** in their output schemas
  (`composes|extends|one-way`, `confirmed|refuted|unverified`) and map it to core's
  `uses_existing|changes_behaviour|one_way_door` and `not_proven`, so the copied instruction files
  work unchanged.
- **Malformed output is returned, not thrown**: an `AgentRunResult` with `status: 'failed'` and
  error code `output_invalid` (the "typed error"), so the session's tokens and cost are still
  recorded. Same for a missing key (`model_access_not_configured`).
- **Judge cost** is computed from the response's token usage and the price table
  (`costSource: 'computed'`); the Messages API reports tokens, not dollars.
- **ClickUp "returns clickup_not_configured"** is a thrown `IntegrationNotConfiguredError`, like
  `GitHubGateway`; every method takes the repository's ClickUp settings first, so a repository
  without them fails before any request.
- **`clickup` replaces the placeholder `clickupSpace`** in `RepositoryConfig` (unused by code).
- **Path guard for every role** as a PreToolUse hook: reads only inside `cwd` and `readDirs`,
  writes only inside `cwd`. The implementer additionally runs with `permissionMode: 'default'` and
  `canUseTool` as the permission callback, with nothing pre-approved, so it cannot read files such
  as the GitHub App key and write them into a branch that gets pushed.
- **Session env** keeps `PATH` and a throwaway `HOME` next to `ANTHROPIC_API_KEY` (the CLI needs
  them); nothing else from the worker's environment.

### Implementation

- **S-04-T1: no `docker create --rm`.** The adapter removes every container itself with an awaited
  `docker rm -f` (one removal at a time). With `--rm` the daemon's auto-removal races ours and
  `docker rm -f` returns early ("removal already in progress"), so "no container left" was not
  deterministic. A worker crash mid-run can leave an exited container; it carries `pra.sandbox=1`,
  so it can be swept by that label.
- **S-04-T1 Docker test** labels its containers `pra.sandbox.test=<uuid>`, pulls `node:24-slim`
  when missing, and skips with a printed reason when `docker version` fails.
- **S-04-T2: WB `installCommand` is now `pnpm install --offline --frozen-lockfile`** (was
  `--ignore-scripts`): the PR's own scripts run, but in the install step with no network, so the
  sandbox, not a flag, keeps them offline (the fixture's postinstall proves it).
- **S-04-T2: the install test has two parts**: step mounts, networks and env checked with
  `FakeSandbox`, and the real two-step install of the fixture in Docker (needs registry access,
  skipped with a printed reason without Docker). Docker test helpers (`dockerSkipReason`,
  `labelledContainers`, `ensureDockerImage`) live in `@pra/integrations/testing`.
- **S-04-T2: `installDependencies` creates the cache folder** if missing and uses default limits
  (fetch 2 CPU / 2 GB / 10 min, install 2 CPU / 4 GB / 15 min), overridable per call.
- **S-04-T4: the judge's input has no `floor`** (overrides the plan contract). The v1 rules already
  say the answer can only raise the paths' tier, core `raiseChangeType` enforces it, and the worker
  decides whether to call the judge at all. Not showing the floor avoids anchoring the model.
- **S-04-T4: the v1 prompt's files travel inline.** The prompt names `{{knowledgeDir}}/classify-rules.md`,
  `task.md` and `files.txt`; one Messages API call has no file access, so the adapter replaces
  `{{knowledgeDir}}` with `instructions` and appends each file as a `<file name="…">` block (task
  text cannot close its block). The instruction files stay unchanged.
- **S-04-T4: API errors are results, not throws**: `agent_failed` with the HTTP status, an abort is
  `cancelled`; the request and response are the transcript. Shared result helpers moved to
  `packages/agents/src/agent-result.ts` (used by `ClaudeAgentRunner` and the judge).
- **S-04-T4: `FakeJudge` and `FakeMessagesClient`** in `@pra/agents/testing` for P-09's Change type
  stage and for adapter tests.
- **Seed CLI test timeout raised to 30 s**: it spawns the CLI twice and hit 5 s under a parallel
  `pnpm verify`.
- **S-05-T1: the verifier keeps the v1 `remedy` field** (`obvious|decision`, mapped to core
  `obvious|needs_decision`) because `verify-rules.md` asks for it; the output carries
  `remedy: {kind, why}` next to verdict, reason, evidence `{file, line, quote}` and `reproduction`.
- **S-05-T1: the session folder is the `cwd`** (fresh temp folder, removed afterwards) with
  `finding.json` (title, file, line, scenario only), `diff.patch`, `task.md` when there is a task,
  and the rules under `instructions/`; `{{knowledgeDir}}` and `{{repoDir}}` are filled, and the
  worktree is the only read dir. Repair adds `script.mjs` and `output.txt`.
- **S-05-T1: the adapter's own prompt lines are English** (fork: quotes only; repair: fix the
  script), appended to the stored v1 prompt as v1 did. `renderPrompt` / `withSessionDir` live in
  `packages/agents/src/prompt.ts`.
- **S-06-T1: settings carry an optional `spaceId`** next to `workspaceId`: v1 searched one space
  (`space_ids[]`); without it the search covers the whole workspace. A repository without settings
  fails with `clickup_not_configured` (`missing: ['RepositoryConfig.clickup']`); no key gives the
  `UnconfiguredClickUpGateway` (`missing: ['CLICKUP_API_KEY']`).
- **S-06-T1: request shapes not yet checked against the live API** (Alek's real-wiring list):
  a mention is sent as a v2 rich comment `comment: [{type: 'tag', user: {id}}, {text}]`, plain
  comments as `comment_text`; a new task's description as `markdown_content` (v1 sent
  `markdown_description`); `parent` must be the parent's ClickUp id, not its custom id.
- **S-06-T1: `getTask` returns null on 404**; 401 is `clickup_auth_failed`; any other status, and
  a network failure (`status: null`), is `clickup_error`.
