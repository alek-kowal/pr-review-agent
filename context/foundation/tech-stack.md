---
starter_id: fastify
package_manager: npm
project_name: pr-review-agent
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: manual-promotion
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: false
  has_payments: false
  has_realtime: true
  has_ai: true
  has_background_jobs: true
---

## Why this stack

PR Review Agent is an internal web app for one team. Its core is long, expensive agent sessions started by GitHub webhooks, a job queue in Postgres, and live updates over SSE. The stack was decided before this step (`docs/01-analysis.md` §4, amended by `docs/04`, `docs/05` and `docs/08`), so this hand-off only maps it onto the starter registry. The registry's default for JavaScript web apps (Astro, Supabase, Cloudflare edge) cannot host multi-minute agent sessions or Docker sandboxes, so the custom path was taken. Fastify is the decided API framework and the product's backbone: webhook ingest, commands, SSE fan-out, and the same Node 24 TypeScript runtime as the pipeline worker. Its card passes all four agent-friendly gates and is verified for scaffolding, and self-host matches the Docker Compose deployment. The scaffold becomes `apps/api` in a pnpm workspace next to the Vite + React 19 SPA, the worker and the shared packages. There is no login and no OAuth: an access gate outside the app controls entry, and actions are signed with names from Settings → Team. Realtime, AI and background jobs are in scope; auth and payments are not.

## Decided stack

Source: `docs/01-analysis.md` §4, amended by `docs/04-accounts-and-signatures.md`, `docs/05-review-triggers.md` and `docs/08-orchestrator-log.md`. Not reopened here.

| Layer | Choice |
| --- | --- |
| Runtime | TypeScript on Node 24 LTS |
| Repo | pnpm workspaces, no Turborepo or Nx: `apps/web`, `apps/api`, `apps/worker`, `packages/core`, `packages/integrations`, `packages/agents`, `packages/db` |
| Web | React 19 + Vite SPA, TanStack Router + TanStack Query, shadcn/ui (Radix + Tailwind) themed with WB tokens. Compact stepper on the PR page; `@xyflow/react` read-only diagram on the Pipeline page |
| API | Fastify + Zod type provider, OpenAPI generated from schemas. SSE for live updates, fed by Postgres `LISTEN/NOTIFY` |
| Database | PostgreSQL 17. Drizzle ORM + drizzle-kit migration files, never ad hoc on start. Local dev: Postgres in Docker Compose |
| Jobs | pg-boss + an explicit run state machine in `packages/core`. A run is a row; each stage is a job keyed by `(runId, stage)`. Cron for the reconcile poll (every 10 min) and retention cleanup |
| Agents | Behind an `AgentRunner` interface. Claude Agent SDK (TS) for reviewer, verifier and implementer; Anthropic TS SDK with structured outputs for judge and analyst. Key from `ANTHROPIC_API_KEY` (env or secret store). Default models, configurable per role and level: reviewer and implementer `claude-opus-5-5`, verifier `claude-sonnet-5-5`, judge `claude-haiku-5-5`. No runtime fake mode: without a key, runs fail with "model access not configured" |
| Agent hardening | Per-role tool allow-lists (reviewer and verifier read-only in the worktree, implementer edits its own worktree only, nobody gets a shell). No settings sources, no MCP. Only the model key in the agent's environment. `maxTurns` and a per-session cost guard |
| Sandboxes | Rootless Docker per session (gVisor if available). Repro scripts with `--network none`, read-only mounts and CPU, memory and time limits. Never in the agent container |
| Git | git CLI via `execa`, bare mirror + `git worktree` per run |
| GitHub | GitHub App `pr-review-agent` with `@octokit/app` and `@octokit/webhooks`. Installation tokens only, including push and merge |
| ClickUp | One organisation API key, optional per repository (on for WB) |
| Access | No login, no roles, no OAuth (`@fastify/oauth2` and `@fastify/secure-session` dropped). Shared access gate outside the app. Signatures are Team members picked inside each signed action's form; the last signer is remembered in the browser |
| Object storage | S3-compatible, for diffs, transcripts, repro output and raw GitHub events. 90-day retention; DB rows kept with no limit |
| Observability | OpenTelemetry + pino + Sentry |
| Testing | Vitest (the prototype's 98 domain tests ported as acceptance tests on `packages/core`, with reason codes). Playwright for key flows. `AgentRunner` test doubles in tests only |
| Deployment | Docker images. Docker Compose on one VM + managed Postgres once a hosting target is chosen |
| Secrets | Cloud secret manager or 1Password Connect in hosted environments, injected into `api` and `worker` only |

## Flags and agent decisions

### Quality-gate and starter-fit flags

1. **No registry card fits the monorepo.** The bootstrapper will scaffold one Fastify app (`fastify-cli generate --lang=ts --esm`) at the repo root. The first roadmap task must move it into `apps/api`, add `pnpm-workspace.yaml`, and create the other apps and packages.
2. **The web app fails one quality gate.** The `vite-react` card is `convention_based: false`: Vite gives no routing or folder conventions. Compensation: TanStack Router file-based routes, shadcn/ui in one fixed components folder, and these conventions written into `AGENTS.md` / `CLAUDE.md`.
3. **`package_manager: npm` is a schema artefact.** The schema requires the card's value. The Fastify template has no `{pm}` placeholder, so it does not change the scaffold. The project uses pnpm: after the scaffold, delete `package-lock.json`, set `packageManager` in the root `package.json`, and run `pnpm install`.
4. **The scaffold's tests use `node:test`.** Replace them with Vitest, as decided.
5. **The starter covers none of these:** Postgres and Drizzle, pg-boss, SSE, the agent SDKs, the React SPA. Roadmap tasks add them, not the bootstrapper.
6. **Isolation holds only on a Linux host.** Rootless Docker and gVisor need Linux. Local dev on macOS Docker Desktop still gets `--network none`, but local runs don't prove the Isolation NFR.
7. **No session cookie means no CSRF protection by default.** If the access gate is cookie-based (an SSO proxy or a shared-password page), a cross-site request can pass it. State-changing endpoints should require a custom request header and check `Origin`. `docs/01-analysis.md` §3.12 #3 listed CSRF as a production blocker.

### Choices the agent made

1. **Starter `fastify`.** It is the decided API framework, passes all four gates and is verified. Rejected: `vite-react`, because it fails a gate and covers only the UI; `turborepo` and `nx`, because §4 decided plain pnpm workspaces and `create-turbo` scaffolds Next.js apps; `hono` and `nestjs`, the card's alternatives, because §4 decided Fastify and rejected NestJS.
2. **Custom path.** The JavaScript web default (`10x-astro-starter`) conflicts with the decided runtime, hosting and access model.
3. **`team_size: solo`.** Alek builds with agents. Change it to `small` if teammates join.
4. **`deployment_target: self-host`, `ci_default_flow: manual-promotion`.** No hosting target exists yet (log #5, #6). Until one does, CI runs lint, typecheck and tests only.
5. **Push and merge use installation tokens as `pr-review-agent`** (log #3). The user-to-server tokens from `docs/01-analysis.md` §3.6 go with OAuth. The signer goes in commit trailers (`Signed-off-in-app-by`, `Co-authored-by`).
6. **Object storage sits behind one blob-store interface.** Local dev writes to a Docker volume; hosted environments use S3-compatible storage. The "complete logs from day one" NFR needs storage in the first slice, before a host is chosen.
7. **Local secrets** go in a gitignored `.env` for dev only, never on servers. Only `*_API_KEY` names are documented, never values.
8. **The self-check was answered on Alek's behalf, all true:** TypeScript + Zod; official generators; fastify-cli layout + pnpm workspaces; current docs; Synergy's own TS, React, Postgres and Drizzle stack.
9. **This file has two extra sections** beyond the schema's single `## Why this stack`. The bootstrapper parses only the frontmatter and copies that paragraph, so the extra sections are safe.

### Still open for Alek (unchanged from the log)

These don't block scaffolding:
- model billing and key ownership (#4),
- the hosting and deploy target (#5, #6),
- which kind of access gate,
- branch protection per repository (#3).
