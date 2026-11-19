# P-06 Sandbox and adapters Implementation Plan

## Overview

Work package P-06 (wave 3): the `Sandbox` integration with a Docker adapter and an offline
dependency install, the judge, verifier and implementer agent adapters, the `ClickUpGateway`, and
task-ID matching with the repository ClickUp settings. Adapters only: the stages that call them come
in P-09 (Checks, Task, Change type, Verify) and P-18 (implementer runs).

Tasks, in order, one commit each: S-04-T1, S-04-T2, S-04-T4, S-05-T1, S-06-T1, S-06-T2, S-13-T1.

## Current State Analysis

- `packages/integrations` has `GitHubGateway`, `GitMirror`, `BlobStore`, `IntegrationError` /
  `IntegrationNotConfiguredError` (`src/errors.ts`), doubles under `src/testing/`, msw for HTTP
  doubles, `execa` for processes. No sandbox, no ClickUp.
- `packages/agents` has `AgentRunner` (`src/runner.ts`) and `ClaudeAgentRunner`
  (`src/claude-agent-runner.ts`): fresh `HOME`, `settingSources: []`, no MCP, env limited to the key,
  `PATH`, `HOME`, `permissionMode: 'dontAsk'`, `ROLE_TOOLS` with only the reviewer
  (`claude-agent-runner.ts:30`), two cost guards, `role_not_supported` for other roles.
- `packages/core` has `CHANGE_TYPES`, `VERDICTS`, `DEFAULT_MODELS` (judge `claude-haiku-5-5`,
  verifier `claude-sonnet-5-5`, implementer `claude-opus-5-5`), `verifierInput(finding)` which drops
  the suggestion (`verification.ts:88`), and `RepositoryConfigSchema` with `installCommand` and a
  placeholder `clickupSpace` (`config.ts:53-54`).
- `packages/db`: schema per file, `pnpm db:seed-repo` (`src/cli/seed-repo.ts`) imports instruction
  files as version 1 from `~/Projects/wb-factory/knowledge`; seed tests spawn the CLI.
- Docker Desktop is available locally (runc only, no `runsc`); CI is Ubuntu with Docker.
- Reference (wb-factory, read only): one CLI wrapper for all roles; judge input = task text plus
  changed paths, tiers `composes|extends|one-way`, may only raise; verifier input =
  `finding.json` `{title,file,line,scenario}` + `diff.patch` (+ task), verdicts
  `confirmed|refuted|unverified`, script exit 0 / 3, one repair = same prompt plus the broken script
  and its output; implementer had only CLI path patterns, full `process.env`, no cost cap.

## Desired End State

- `Sandbox.run()` runs one throwaway, labelled, locked-down container and always cleans it up;
  `installDependencies()` fetches with network and installs without it.
- `judge`, `verifyFinding`/`repairReproduction` and `runImplementer` exist in `@pra/agents`, return
  the same `AgentRunResult` shape (status, error code, usage, real cost, transcript) as the reviewer.
- `ClickUpGateway` with an HTTP adapter; `findTaskId` in core; `RepositoryConfig.clickup`,
  `fetchCommand`; `pr_task_links` table and migration; seed flags for ClickUp.
- Every task's "Done when" test passes; `pnpm verify` is green.

### Key Discoveries

- `pnpm fetch` writes the virtual store into the project's `node_modules`, so the fetch step needs
  a writable worktree; `pnpm install --offline` then works with the store mounted read-only and no
  network (checked by hand with `node:24-slim` and corepack, see Decisions).
- Under `permissionMode: 'dontAsk'` the SDK never calls `canUseTool`; a PreToolUse hook deny wins
  over pre-approval (`sdk.d.ts`, comment on permission denials).
- `@anthropic-ai/sdk` 1.10 supports `output_config.format` JSON schema on `messages.create`.

## What We're NOT Doing

- No stages, jobs or worker wiring (P-09, P-18); no UI; no `getCiStatus` (S-04-T3).
- No custom sandbox image; no egress proxy limiting the fetch step to the registry.
- No queries for `pr_task_links` (the Task stage in P-09 writes it).
- No real Docker, ClickUp or Anthropic calls in tests other than local Docker containers.

## Implementation Approach

Interfaces first, adapters behind them, doubles in `*/testing`. Agent adapters are thin functions
over `AgentRunner` (verifier, implementer) or the Anthropic client (judge): they build the input
files and prompt, pick the output schema and map it to core vocabulary. Instruction text arrives as
data (version 1 from the database), never read from disk by the adapter.

## Phase 1: Sandbox (S-04-T1)

**Files**: `packages/integrations/src/sandbox/{sandbox.ts,docker-sandbox.ts,index.ts}`,
`src/testing/sandbox.ts` (`FakeSandbox`), tests `sandbox.test.ts` (args, no Docker) and
`sandbox.docker.test.ts` (Docker-gated).

**Contract**: `Sandbox.run(spec) → SandboxResult`.
`spec = { image, command: string[], workdir, mounts: {hostPath, containerPath, writable?}[],
env?: Record<string,string> (the allow-list), network?: 'none' | 'egress' (default none),
limits: {cpus, memoryMb, pids, timeoutMs}, labels?, signal? }`.
`SandboxResult = { exitCode: number | null, output, outputTail, timedOut, durationMs }`.
Docker adapter (`DockerSandbox`, `createSandbox(env)` reads `SANDBOX_DOCKER_HOST`): `docker run`
through `execa` with `--name pra-sbx-<uuid>`, `--label pra.sandbox=1`, `--network none`,
`--read-only`, `--tmpfs /tmp`, `--user <uid>:<gid>`, `--cap-drop ALL`,
`--security-opt no-new-privileges`, `--cpus/--memory/--memory-swap/--pids-limit`, mounts `:ro`
unless writable, `-e` only for the allow-list, `--runtime runsc` when `docker info` lists it.
Timeout or abort → `docker rm -f <name>`; abort rejects with `IntegrationError('sandbox_cancelled')`.
Unreachable daemon or missing CLI → `IntegrationNotConfiguredError('sandbox_not_configured')`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/integrations test sandbox.docker.test.ts` passes with Docker (network, ro
  mount, timeout, abort cleanup, env allow-list) and skips with a printed reason without it
- `pnpm --filter @pra/integrations test sandbox.test.ts` passes (args, not configured)
- `pnpm verify` passes

## Phase 2: Offline install (S-04-T2)

**Files**: `packages/integrations/src/sandbox/install.ts`, fixture
`src/testing/fixtures/install-repo/`, test `install.test.ts`; `packages/core/src/config.ts`
(`fetchCommand`), WB seed and the core WB fixture.

**Contract**: `installDependencies(sandbox, { worktree, config: {fetchCommand, installCommand},
cacheDir, image?, signal? }) → { status: 'ok' | 'failed' | 'skipped', fetch, install }`. Fetch step:
network `egress`, worktree and cache writable, `--ignore-scripts`. Install step: network `none`,
worktree writable, cache read-only. Only the worktree and the cache are mounted (never the mirror).
Commands run as `sh -c` after enabling corepack shims in `/tmp/bin`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/integrations test install.test.ts` passes: offline install ok, `node_modules`
  exists, the postinstall recorded a failed network call; mounts and networks per step asserted
  with `FakeSandbox`
- The WB seed sets both commands; `pnpm verify` passes

## Phase 3: Judge adapter (S-04-T4)

**Files**: `packages/agents/src/judge/{judge.ts,index.ts}`, `src/testing/fake-judge.ts`,
`judge.test.ts`; seed lists `prompt-classifier.md`, `classify-rules.md`.

**Contract**: `Judge.judge({ model, instructions: {prompt, rules}, task, changedFiles, floor,
signal }) → AgentRunResult<{ changeType: ChangeType; reason: string }>`. `AnthropicJudge({apiKey,
client?})` calls `messages.create` with `output_config.format` (tiers `composes|extends|one-way`,
mapped to core change types), `effort: 'low'`; tokens from `usage`, cost from the price table.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/agents test judge.test.ts` passes: valid output parsed, malformed output gives
  `output_invalid`, tokens and cost recorded, no key gives `model_access_not_configured`

## Phase 4: Verifier adapter (S-05-T1)

**Files**: `packages/agents/src/verifier/{verifier.ts,index.ts}`, `verifier.test.ts`;
`ROLE_TOOLS.verifier = Read, Grep, Glob`; seed lists `prompt-verifier.md`, `verify-rules.md`.

**Contract**: `verifyFinding(runner, { model, worktree, finding: VerifierInput, diff, task,
instructions, maxTurns, maxCostUsd, signal }) → AgentRunResult<VerifierOutput>` and
`repairReproduction(runner, {...same, script, output})`. Input files (`finding.json` built field by
field, `diff.patch`, `task.md`, rules) go to a fresh session folder used as `cwd`; the worktree is a
read dir. Output: `verdict` (`confirmed|refuted|not_proven`), `reason`,
`evidence {file, line, quote}[]`, `reproduction` (`.mjs` source or null).

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/agents test verifier.test.ts` passes: no suggestion text in prompt or files,
  tools exactly Read, Grep, Glob, malformed output is `output_invalid`, cost recorded

## Phase 5: ClickUpGateway (S-06-T1)

**Files**: `packages/integrations/src/clickup/{clickup-gateway.ts,http-clickup-gateway.ts,index.ts}`,
`src/testing/clickup.ts` (`FakeClickUpGateway`), `clickup.test.ts` (msw).

**Contract**: every method takes the repository's settings first (`{workspaceId} | null`):
`getTask(settings, id) → ClickUpTask | null`, `findTaskMentioningPr(settings, prUrl)`,
`createComment(settings, taskId, {text, mentionUserId?})`, `createTask(settings, listId, {name,
description, parentId?})`. No key or no settings → `clickup_not_configured` before any request;
401 → `clickup_auth_failed`; other failures → `clickup_error {status}`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/integrations test clickup.test.ts` passes

## Phase 6: Task IDs and ClickUp settings (S-06-T2)

**Files**: `packages/core/src/task-id.ts`, `packages/core/test/task-id.test.ts`, `config.ts`
(`clickup`, replaces `clickupSpace`), `packages/db/src/schema/clickup.ts` (`pr_task_links`), a
generated migration, seed CLI flags, `packages/db/src/seed-clickup.test.ts`.

**Contract**: `findTaskId(branch, title, pattern) → string | null` (branch first, case-insensitive,
no match inside a longer word). `RepositoryConfig.clickup = {workspaceId, followUpListId,
taskIdPattern} | null`. `pr_task_links(id, pull_request_id unique, task_id, url, name, how, linked_by,
linked_by_member_id, created_at)`.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/core test task-id.test.ts` and `pnpm --filter @pra/db test seed-clickup.test.ts`
  pass; `pnpm db:migrate` applies the migration on a fresh database (db test global setup)

## Phase 7: Implementer adapter (S-13-T1)

**Files**: `packages/agents/src/implementer/{implementer.ts,index.ts}`, `src/path-guard.ts`,
`claude-agent-runner.ts` (role policy), `implementer.test.ts`; seed lists `prompt-implementer.md`,
`implement-rules.md`.

**Contract**: `runImplementer(runner, { model, worktree, findings, answers, instructions, maxTurns,
maxCostUsd, signal }) → AgentRunResult<{ fixedFindingIds, declined, summary }>`.
`ROLE_TOOLS.implementer = Read, Glob, Grep, Edit, Write`. Path guard: reads inside `cwd` and
`readDirs`, writes inside `cwd` only, resolved through `realpath` of the nearest existing ancestor
(symlinks included). Implementer: `permissionMode: 'default'`, nothing pre-approved, `canUseTool` =
the guard. Every role also gets the guard as a PreToolUse hook.

### Success Criteria

#### Automated Verification

- `pnpm --filter @pra/agents test implementer.test.ts` passes the five checks of the task
- `pnpm verify` passes

## Testing Strategy

- Docker tests label every container with a per-run id and check cleanup by that label, use temp
  folders only, and skip with a printed reason when `docker version` fails.
- Agent tests use the fake `query` / fake Anthropic client; no network.
- DB tests use the per-run database; the ClickUp seed test uses its own repository slug.

## References

- Tasks: `context/foundation/roadmap-tasks.md` S-04, S-05, S-06, S-13; package block in
  `context/foundation/work-packages.md`.
- Reference: `~/Projects/wb-factory/src/{classify,verify,implement,agent,clickup,sandbox}.ts`.

## Progress

### Phase 1: Sandbox

#### Automated

- [ ] 1.1 sandbox.docker.test.ts passes with Docker, skips with a reason without it
- [ ] 1.2 sandbox.test.ts passes
- [ ] 1.3 pnpm verify passes

### Phase 2: Offline install

#### Automated

- [ ] 2.1 install.test.ts passes
- [ ] 2.2 WB seed sets both commands; pnpm verify passes

### Phase 3: Judge adapter

#### Automated

- [ ] 3.1 judge.test.ts passes

### Phase 4: Verifier adapter

#### Automated

- [ ] 4.1 verifier.test.ts passes

### Phase 5: ClickUpGateway

#### Automated

- [ ] 5.1 clickup.test.ts passes

### Phase 6: Task IDs and ClickUp settings

#### Automated

- [ ] 6.1 task-id.test.ts and seed-clickup.test.ts pass; migration applies

### Phase 7: Implementer adapter

#### Automated

- [ ] 7.1 implementer.test.ts passes
- [ ] 7.2 pnpm verify passes
