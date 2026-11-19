# P-06 Sandbox and adapters — Plan Brief

> Full plan: `context/changes/P-06-sandbox-and-adapters/plan.md`

## What & Why

The round stages in P-09 and the implementer in P-18 need an isolated place to run PR code and
three more agent roles. P-06 builds those pieces behind interfaces, with doubles, and no stages.

## Starting Point

`GitHubGateway`, `GitMirror`, `BlobStore` and `ClaudeAgentRunner` (reviewer only) exist from P-03;
repository config and the WB seed from P-02/P-04.

## Desired End State

`Sandbox` (Docker, locked down, always cleaned up) and an offline install; judge (Anthropic SDK,
structured output), verifier and implementer (Agent SDK) adapters with a path guard;
`ClickUpGateway`; `findTaskId`, `RepositoryConfig.clickup`/`fetchCommand`, `pr_task_links`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Sandbox driver | `docker` CLI via execa | No new dependency, same tool as the host re-check |
| Install | fetch with network and writable worktree, install offline with read-only cache | `pnpm fetch` must write `node_modules`; verified by hand |
| Errors from adapters | returned `AgentRunResult` with a code | Cost is recorded even on bad output |
| Instruction vocabulary | v1 terms in schemas, mapped to core | Copied instruction files work unchanged |
| Path guard | PreToolUse hook for all roles, `canUseTool` for the implementer | Stops reading secrets and writing outside the worktree |

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1 Sandbox | `Sandbox`, `DockerSandbox`, `FakeSandbox` | Docker flakiness in parallel runs |
| 2 Install | `installDependencies`, `fetchCommand` | Registry access in tests |
| 3 Judge | `AnthropicJudge` | SDK request shape |
| 4 Verifier | `verifyFinding`, `repairReproduction` | Leaking the suggestion |
| 5 ClickUp | `HttpClickUpGateway` | API shapes |
| 6 Task IDs | `findTaskId`, settings, `pr_task_links` | Migration numbering vs parallel packages |
| 7 Implementer | `runImplementer`, path guard | SDK permission semantics |

**Prerequisites:** Docker running locally (tests skip without it). **Effort:** one session.

## Open Risks & Assumptions

- Rootless Docker uid mapping and gVisor are only checked on the Linux host (S-04-T9).
- The worker container needs the `docker` CLI and host-identical worktree paths when it runs in
  Compose; that wiring is deploy work (S-04-T8/T9), not this package.
