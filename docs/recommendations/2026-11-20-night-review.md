# Night review, 20 Nov 2026

1. **Build the two missing primitives, nothing more:** a **Work item** (what a run is about; today every run must be a PR) and a **Pipeline as data** (one stage list the engine reads; today there are three lists and a ternary). Everything else already exists. Do it in small expand/contract steps, starting right after STAGEFILES lands.
2. **Make Plan the second pipeline** (task → plan → plan review → signed plan). You already run it by hand every night (`/10x-plan`, hand-written package prompts). It writes a document, never the repository, and it gives the reviewer a contract to check the PR against.
3. **Position the app as the control plane, not the reviewer.** The value is signed decisions, versioned team knowledge, gates, budgets and evidence. Make the reviewer a swappable slot (a bought reviewer included) and spend effort on evals and on deleting lessons, not on more prompt logic.
4. Not yet: no pipeline editor, no DAG, no UI rename, no move of all 20 PR foreign keys, no autonomy for new pipelines before evals.
5. One question for you: is Plan's first user you (this repo's work packages) or the WB team (ClickUp tasks)? I would start with you.

Written by an agent from two research notes (courses and app), with spot checks in the code. No code was changed.
Shorthands. Courses: `L:` = `~/Projects/wiedza/lekcje/`, `T:` = `~/Projects/wiedza/tematy/`, `M:` = `~/Projects/MEGA/`; `#4` = thesis 4 in that note. Code: `core/` = `packages/core/src/`, `db/` = `packages/db/src/`, `agents/` = `packages/agents/src/`, `integrations/` = `packages/integrations/src/`, `worker/` = `apps/worker/src/`, `api/` = `apps/api/src/`, `web/` = `apps/web/src/`.

## Part A: Primitives and the AI Software Factory

### A.1 What the courses mean by a primitive

- MEGA: primitives are "general building blocks that can be combined to achieve reliable, even deterministic, outcomes" (M:s02e02-building-an-agent.md:63). Like UNIX tools: "small tools that each do one thing well and connect through a shared interface" (M:s01e05-building-workflows-not-tool-stacks.md:98).
- The idea: do not design features; shape the environment from a few general pieces and let agents compose behaviour nobody planned (L:mega-s02e02-building-an-agent #4).
- The payoff is growth: "extend the capabilities of the entire system with minimal code changes" (M:s02e04-multi-agent-collaboration.md:237). General primitives let one system serve a second process (L:mega-s02e04-multi-agent-collaboration #9).
- Kent: the data model holds primitives too, and "everybody's primitives are going to be unique to the software that they are building" (M:transkrypty/s03e02-wideo.md:2). Below ~20k lines you can ignore them (M:transkrypty/qa-kent.md:161). We have 61.5k source lines after two days.

**The test I used.** I call a concept a primitive only if all four hold:
1. **Two real uses.** It serves today's review and the next pipeline, not a guessed future. A primitive costs more than a feature (L:mega-s03e01-mechanics-behind-product-engineering #3); turn something into one when implementations start to repeat (L:mega-s03e02-wideo-kent #4).
2. **Domain-free contract.** Its one-line contract does not mention PR, finding, round or GitHub (L:mega-s02e04-multi-agent-collaboration #9).
3. **Survives a better model.** It does not exist to patch a weakness of today's model (L:mega-s02e04-multi-agent-collaboration #1).
4. **Owned by code.** The harness enforces it; a prompt cannot bypass it (L:mega-s02e02-building-an-agent #7, L:mega-s02e05-agent-reliability #3).

### A.2 The primitive set I recommend

Ten primitives. Seven exist and need one key change. Work item and Pipeline are missing or half-built. The Artifact is a new kind of an existing one (Document).

| Primitive | What it is | Contract in one line | Exists today | Gap |
|---|---|---|---|---|
| **Work item** | What a pipeline works on: idea, task, plan, PR, release, incident, with typed links | `{id, project, type, externalRef, state}` + links (`implements`, `splits`, `fixes`, `ships`); runs, decisions and journal point at one | `pull_requests` is the de facto one (db/schema/repositories.ts:35); one link kind, ClickUp task ↔ PR (db/schema/clickup.ts:13); `project` = today's repository | No table. `runs.pull_request_id` NOT NULL (db/schema/runs.ts:87-89); 20 PR foreign keys in 13 schema files |
| **Pipeline** | A named, ordered list of stages: executor, role, slots, on-from level, timeout, gate | `planRun(pipeline, workItem, level) → plan`, and the plan is stored on the run | `PipelineStage` already declares role, tools, files, output, attempts (agents/pipeline.ts:12-45); STAGEFILES adds slots the worker reads | The engine does not read it: the plan is a ternary (core/run.ts:77-111) + `STAGE_ON_FROM` (core/levels.ts:24) + `STAGE_EXECUTORS` (worker/stages/index.ts:20-38). Plan not stored (db/queries/run-state.ts:14-54). Kinds closed by CHECK (db/schema/runs.ts:149) |
| **Run** (+ stage execution) | One execution of a pipeline on one work item; one row per stage attempt | pure transitions `nextStage / startStage / finish`; retry reuses succeeded stages | db/schema/runs.ts:83,162; core/run.ts:113-223; one `run.stage` queue (db/queue.ts:19); retry with reuse (db/queries/retry.ts:29-153); recovery (worker/run/recover.ts:47-119) | Needs a PR and `head_sha`; `StageResult` carries findings and questions (worker/stages/stage.ts:48-61); one active run per PR (db/schema/runs.ts:143) |
| **Agent session** | One model session from a role profile, with typed output, cost and transcript | `run<T>({role, model, prompt, readDirs, outputSchema, maxTurns, maxCostUsd, timeoutMs}) → {output, cost, transcript}` | `AgentRunner` (agents/runner.ts:5-33); session ledger (db/schema/runs.ts:189) | Roles closed (core/vocabulary.ts:26, CHECKs db/schema/runs.ts:196,219); tools and models in code (agents/claude-agent-runner.ts:47-51, core/levels.ts:40-46); judge and analyst bypass the runner (agents/judge/judge.ts:24, agents/analyst/analyst.ts:25) |
| **Document** (versioned) | Any text an agent reads or writes: instruction, reference document and, new, **artifact** (PRD, plan, ADR, release record) | draft → active → archived; activation is signed; a run freezes the versions it read | db/schema/instructions.ts:32,62,90; `resolveInstructions` (core/instructions.ts:69-90); STAGEFILES adds kinds `instruction`/`document` and per-stage slots | No `artifact` kind, no work-item scope; frozen versions stored twice (`runs.instruction_versions` jsonb and `run_instruction_versions`) |
| **Decision** | A signed choice on something an agent proposed: a finding, a question, a plan, a gate | `{workItem, target, choice, actor, signer, reason}`; append-only; undo marks, never deletes | `decision_batches` (db/schema/team.ts:47); answers (db/schema/reviews.ts:25); Actor kinds (core/vocabulary.ts:33-37) | Keyed on `pull_request_id` NOT NULL; choices fixed to Implement/Reject/Defer; questions and decisions are two shapes |
| **Settings change** | A signed config change with before/after in the one audit log | `applySignedSettingsChange(store, before, after, signer)`; 409 when stale | api/settings/signed-change.ts:14-103; db/schema/settings-changes.ts:10; 13 stores | None. STAGEFILES already uses it for slots; every pipeline setting should too |
| **Event** (journal) | Append-only record of what happened, plus inbound signals that start pipelines | `append({workItem, kind, params, actor, cost, sourceKey})`, idempotent; a trigger maps event kind → pipeline | Timeline with idempotent `source_key` (db/schema/timeline.ts:26); `github_events` (db/schema/repositories.ts:92); NOTIFY → SSE (db/live.ts:7-16) | Keyed on PR; triggers are GitHub-named (`githubEvents`, `prEventHooks`, worker/extensions.ts:13-35); one webhook route |
| **Gate** | A check before a run, stage or session; budget is one gate | `check(ctx) → allow \| wait(reason) \| ask(decision)`; a wait resumes through the drainer | `beforeRoundStart`, `beforeSession` (worker/run/gates.ts:12-36; core/start-gate.ts:43-58); `run_waits` + `run.drain` (worker/run/drain.ts:21-54) | No "ask a person" outcome; slot holder is a PR number (core/start-gate.ts:17); budget per day only |
| **Gateway** | The only way out: code host, tracker, sandbox, blob store, model API | an interface in `@pra/integrations`; verify after a write; a send key for irreversible writes | `Sandbox`, `BlobStore`, `GitMirror` are clean (integrations/sandbox/sandbox.ts:5-58, integrations/blob-store/blob-store.ts:2-10); outbound log `github_actions` (db/schema/runs.ts:319) | `GitHubGateway` has 20 PR-keyed members (integrations/github/github-gateway.ts:8-62); `github_actions` has no send key |

**Folded into another primitive:**
- Level (autonomy ladder) → a property of Pipeline: which stages run from which level. The idea is strong (earned autonomy, shadow log as evidence); keep one ladder per pipeline.
- Budget, pause, agent slots, usage limit, sensitive files → Gate.
- Sandbox, BlobStore, GitMirror → Gateway. They are already clean; nothing to design.
- Question/Answer → Decision: the agent offers 2–3 options, a person signs one.
- Lesson → a Document (the lesson file) + a Decision (accept) + the Learn pipeline. Learning is a pipeline, not a primitive.
- Trial and shadow log → a run mode: draft documents, no external writes.
- Alert and metrics → views over Event.

**Rejected for now:**
- Finding, verdict, fix check, round, chain, change type, patch, merge checklist, the 17 PR states: the review plug-in. They fail test 2. Forcing PRD gaps into `findings.file NOT NULL` would be the bespoke-tool trap in reverse.
- Schedule (L:mega-s02e02-building-an-agent #4): nothing needs self-set wake-ups yet; the poller and drainer are internal. Add it with the first nightly job.
- Channel: one channel today (the web app), plus one ClickUp comment and one GitHub sentence. Add it when Slack or mail arrives.
- Skill as a runtime primitive: executors are our deterministic skills. Kent: "Skills are bad. […] You want software." (L:mega-qa-kent #9)
- `CodeHost` / `Tracker` interfaces: write the rule now as an ADR ("no vendor logic outside gateways", L:mega-s03e01-wideo-kent #3); build the interface when a second vendor appears.

### A.3 How the factory grows on these primitives

Each stage of the process is a pipeline over a work item, made of the same ten primitives. Only executors, roles, documents and gates differ. The shape follows Kent's ship state machine (L:mega-s03e03-wideo-kent #6), overment's chain intent → contract → plan → proof → learn (L:mega-s03e02-translating-intent-into-agent-work, L:mega-s03e05-products-that-learn-after-release) and his stage cards with a "learn" arrow back into the playbook (M:s02e04-multi-agent-collaboration.md:211).

| Pipeline | Work item in → out | Stages | Artifact | Person signs | Gateways |
|---|---|---|---|---|---|
| Idea | idea → PRD | frame, research, draft, critic | PRD | the PRD | Tracker |
| **Plan** | task → plan | read task and feature map, draft plan, plan review on another model, check against the primitives catalogue | plan (contract: scope, result, proof per criterion) | the plan | Tracker, GitMirror (read) |
| Implement | plan → PR | split (≤ 4 subtasks), implement in sandbox, self-check, open PR | patch, evidence table | push, unless a two-way door | Sandbox, CodeHost |
| Review (today) | PR → decisions | checks, task, change type, review, verify, fix | findings, decisions | decisions, push, merge | CodeHost, Tracker |
| Test | PR → evidence | black-box lab run against Do / Expect / Never written first | evidence table | only on a fail | Sandbox |
| Deploy | merged PR → release | deploy, watch, health check | release record (contract + evidence) | one-way doors only | deploy target |
| Monitor | release → issue | subscribe to errors and feedback, dedupe, triage | issue, friction issue | ideas only; bugs go to Plan | monitoring, Tracker |
| Learn | any closed item → lessons | analyse, propose additions **and removals**, route each to a destination | lesson, rule, eval case | the accept | none |

Sources per row: PRD and contract (L:mega-s03e02-translating-intent-into-agent-work #4, #7); short plan with proof (L:mega-s03e03-ai-native-product-development); dispatch into ≤ 4 subtasks (L:aitl-l13-zadania-rownolegle-i-automatyzacje-praca #6); lab test (L:mega-s04e01-wideo-john #3, #4); release record (L:mega-s03e05-products-that-learn-after-release #4); learn destinations (same note #8).

**Which pipeline second: Plan.** Why:
- **Real friction.** You run it by hand every night: 25 prompt files in `tools/orchestrator/prompts/`, `/10x-plan` → `/10x-plan-review` per package (docs/ORCHESTRATOR-STATE.md:19-21), and a terminal supervisor that scrapes panes for context %, API errors and usage limits (docs/orchestrator-lessons.md items 5–8). The app already has the harness duties those scripts imitate: runs, waits, a usage-limit gate, recovery, a cost ledger. The courses say a factory grows from your own friction, not from a plan (T:fabryka-oprogramowania; M:build-guide/s04e01.md:29).
- **Kent's order.** Input quality first, then catching errors, then limiting damage (L:mega-s03e01-wideo-kent #7). Review is "catching errors". Plan is "input quality".
- **Low risk.** It writes a document, never the repository. A two-way door.
- **Better review at once.** The reviewer gets a signed contract and reports each criterion with proof or "missing" (L:mega-s03e04-verifying-product-outcomes #3), instead of guessing intent from a ClickUp text.
- **It needs exactly the missing pieces** (Work item, Artifact, an "ask a person" gate) and gives them a second real use, which is test 1.
- **It tests the catalogue.** Kent's test of primitives is whether an agent turns a product spec into a plan that uses the same primitives you would (M:transkrypty/qa-kent.md:476). The plan review stage can check exactly that.

Implement comes third, only when signed plans exist and the review metrics show the team keeps up. More PRs do not make a faster team; review is the serial part (L:aitl-l13-zadania-rownolegle-i-automatyzacje-praca #1).

Start with yourself as the user (this repo's work packages), then the WB team. John's order is lab → team → customers (L:mega-s04e01-wideo-john #9); overment says start with a system you use yourself (L:mega-s04e01-mechanics-behind-autonomous-systems #10).

### A.4 Migration path

Rules for every step: it merges alone, the review pipeline stays green (`pnpm verify`, e2e), and one revert or a down migration undoes it. Schema steps go expand → backfill → switch reads → contract later. Size: S ≈ one agent package, M ≈ two, L ≈ three or more with a migration.

0. **Catalogue and ADRs (S, docs only).** `docs/primitives.md`: the ten primitives, each with its contract, invariants and links to code, like Kent's `primitives.yaml` (L:mega-s03e02-wideo-kent #4). ADR-1 "the run engine knows no PR; review is a plug-in". ADR-2 "no vendor logic outside gateways". A "System changes" line in the PR template: does this change compose, extend, or create a primitive (one-way door) (M:s03e04-verifying-product-outcomes.md:29). A lint check that catalogue links resolve (L:mega-s03e03-wideo-kent #5). *Unlocks:* agents compose instead of inventing; the orchestrator's packages declare their risk.
1. **One stage list (M), right after STAGEFILES.** A `PipelineDefinition` type in core; the review, implementer and analyst definitions grow out of `agents/pipeline.ts`, which STAGEFILES already makes partly executable. `planRun` reads a definition; the worker checks at start that each stage has an executor; the diagram reads the same object. Store the computed plan on the run (`runs.plan` jsonb). *Unlocks:* a new pipeline = a definition plus executors; a deploy no longer changes the plan of runs in flight; three lists become one.
2. **Open roles and kinds (S–M).** A role profile as data `{role, tools, defaultModel, slots}` replaces `ROLE_TOOLS`, `DEFAULT_MODELS` and the role CHECKs. The run kind is checked against the pipeline registry, not a DB CHECK. Judge and analyst go through the same model-call ledger. *Unlocks:* a `planner` role without a migration; all model cost in one place.
3. **Work item (L, expand/contract).** New `work_items` and `work_item_links`. Backfill one item per PR (type `pull_request`). Add `runs.work_item_id`, write both, switch reads, then make `pull_request_id` and `head_sha` nullable and move them into a review run input, the way the implementer kind keeps its own input table (db/queries/implementer.ts:117-150). One active run per work item and pipeline. Move the timeline to `work_item_id` in the same step. Review tables stay PR-keyed. *Unlocks:* a run on a task or a plan.
4. **Stage output, not review result (M).** `StageResult = {output, sessions, waits}` plus one result writer per pipeline. The review writer stores findings, questions and fix checks and owns the retry copy (db/queries/retry.ts:129-153). *Unlocks:* stages that produce documents.
5. **Artifact as a document kind (M).** On top of STAGEFILES: kind `artifact`, scope `work_item`. A stage writes a draft version; a signed decision makes it active; later runs freeze it like instructions. First remove the duplicate freeze storage. *Unlocks:* PRD, plan, release record.
6. **"Ask a person" gate and a general decision (M).** A gate outcome `ask` writes a wait and shows "Action needed"; a signed decision on the work item resumes it through `run.drain`. Decisions get `work_item_id` and a `target` reference; each pipeline lists its choices. "No answer is never consent" (L:mega-s04e01-mechanics-behind-autonomous-systems #6). *Unlocks:* "approve plan", later "approve deploy".
7. **Plan pipeline (L).** Started by hand first ("Plan this task"). Planner on one model, plan review on another family (OpenRouter is already wired for the judge, core/openrouter.ts). Output: a plan artifact with proof per criterion. The reviewer gets the signed plan through a document slot.
8. **Event triggers (M), only when a second source is real.** Webhook, poller and tracker write one event shape with a dedup key; a trigger table maps event kind → pipeline. Rename `githubEvents` and `prEventHooks` then.

If Plan turns out not to be wanted, stop after step 2. Steps 0–2 pay off for review alone.

**What not to do yet:**
- No pipeline editor, DSL, DAG or parallel stages. No pipeline needs them. Add only what reliability needs (L:mega-s04e01-mechanics-behind-autonomous-systems #1).
- No rename of the product or the UI copy (3,081 lines, ~237 "PR"). Generalise a screen when a second pipeline needs it.
- No move of all 20 PR foreign keys. Review tables stay PR-keyed as the plug-in.
- No `CodeHost`/`Tracker` abstraction before a second vendor. No multi-tenancy, no accounts.
- No levels 5–6 (autofix, learning) for new pipelines until evals and decision data earn them (L:mega-s03e04-verifying-product-outcomes #1).
- No agent swarm or agent-to-agent chat: "A software factory does not begin with a swarm of autonomous agents talking over one another" (M:build-guide/s04e01.md:459).

### A.5 Risks and the courses' warnings that apply to us

- **"Don't build your own AI review, buy one."** Kent expects AI code review to stop being a separate thing within a year. Until then, buy a tool, and never let it be the only reviewer (L:mega-qa-kent #5). 10xDevs is softer: start from a ready-made action; build your own only for a hard gate or a cheap model (T:review-kodu-generowanego-przez-ai). Caveat: Kent works solo and gets reviewers for free. What it means for us:
  - The reviewer prompt and model are the part that ages fastest. They are not the product.
  - The product is the process around them: signed decisions, versioned team knowledge (instructions, feature maps, lessons), frozen and repeatable runs, gates, budgets, evidence and the earned-autonomy ladder. A bought reviewer gives a team none of that. Kent: judgment and product vision are the moat (L:mega-s03e05-wideo-kent #7).
  - We have one real reason a bought tool does not fit as-is: findings must never appear on the public PR (context/foundation/prd.md:63). That justifies our pipeline, not a home-made reviewer.
  - So: turn "review" into a slot that can hold our reviewer, a bought reviewer run in the sandbox, or both, with our verifier and signed decisions on top. Kent runs three reviewers on different models (L:mega-s03e03-wideo-kent #4). Score them on the eval set (A.6) and keep the cheapest that passes.
- **Maintenance is the cost, not the first version** (T:wewnetrzne-narzedzia-ai). 61.5k source and 40.9k test lines in two days, owned by one person. Before each new pipeline ask "should we take over this responsibility?". Kent: one or two people own the factory (M:transkrypty/qa-kent.md:104). A harness without an owner bloats (L:aitl-l15-retrospektywa-wnioski-po-pierwszym-cyklu #8).
- **A primitive costs more than a feature** (L:mega-s03e01-mechanics-behind-product-engineering #3). Every step in A.4 is tied to the Plan pipeline. Without Plan, stop after step 2.
- **Logic around the model ages** (L:mega-s02e04-multi-agent-collaboration #1). Rounds and chains, the change-type judge, `maxFindings`, the separate verifier: in three months, check which of them a better model made useless. The primitives should outlive them.
- **Loops that only add make agents worse** (L:mega-s03e05-products-that-learn-after-release #10). Today `lessons.md` can only grow: candidates are proposed, accepted or rejected (db/schema/learning.ts:87), and nothing retires a lesson.
- **Autonomy before trust.** "Agents will happily build the wrong things fast" (L:mega-s03e04-verifying-product-outcomes, main thesis). More pipelines mean more output for the same few reviewers; agent slots are the WIP limit, keep them at what people can decide.
- **Untrusted text in prompts.** Plan and Learn read task text, PR text and comments. Treat them as data, not instructions (T:petla-feedbacku-po-wydaniu). Our instructions live in the DB, not in the PR branch, so a PR cannot change its own criteria; that already follows 10xDevs (L:10xdevs4-m5l3-code-review-w-erze-ai #1, #2). Keep it so for new pipelines.
- **Duplicates spread.** Two `PR_STATES` (db/schema/repositories.ts:31 and core/pr-state.ts:11), the verdict stored twice, frozen versions stored twice. Kent's three combo boxes (L:mega-s03e02-wideo-kent #4): merge them before new pipelines copy them.
- **The course is not finished.** MEGA S04E02 onwards (autonomous systems) is out by 23 Nov and may change this picture. No course describes one product from idea to monitoring; this plan combines Kent, overment, John and AI Tech Leaders.

### A.6 Other improvements from the courses (not about primitives)

- **Eval set:** 10–20 past WB PRs with known problems plus planted bugs; run it before "Make active" on any instruction or model change; deterministic checks first, an LLM judge from another family (T:evale-w-produkcji-i-ci, T:ewaluacja-agentow). Trial today compares one PR at a time (core/trial.ts).
- **Every checker fails once on purpose:** the verifier must refute a planted false finding (T:ewaluacja-agentow).
- **The author model never checks itself:** the implementer and the fix-check reviewer both default to Opus (core/levels.ts:40-46); move fix check or verify to another family (L:mega-s03e03-wideo-kent #4).
- **Rules before lessons:** a reviewer comment seen twice becomes a lint rule, type or test; order: simpler code, then checks, prose last (L:mega-s03e04-verifying-product-outcomes #9, T:hooki-i-automatyczne-kontrole).
- **Lesson destinations and pruning:** each candidate names where it goes (lint, test, eval case, instruction, feature map, issue); the analyst also proposes removals; a lesson ends when its signal goes quiet (L:mega-s03e05-products-that-learn-after-release #8, #10).
- **One model-call ledger with full context,** so a stage can be replayed with a changed instruction (L:mega-s02e05-agent-reliability #6, #8).
- **Heartbeat** on running stages to tell working, waiting and stuck apart (L:mega-s02e04-multi-agent-collaboration #8).
- **Cost per finished work item and per pipeline,** not per token; a per-pipeline budget next to the daily one (L:10xdevs4-m5l2-twoj-pierwszy-agent-zespolowy-sdk #7, #8).
- **Factory metrics in five groups:** flow, quality, cost, autonomy, effect; never % of AI code (T:mierzenie-efektu-i-kosztow-ai).
- **One permission rule set with allow / deny / ask:** today it is spread over `ROLE_TOOLS`, the path guard, sensitive files and the typed PR number (L:mega-s04e01-mechanics-behind-autonomous-systems #6).
- **Outbox with a send key** for push, merge and comments, so a repeated job never repeats them (L:mega-s04e01-mechanics-behind-autonomous-systems #3); `github_actions` logs writes but has no unique key (db/schema/runs.ts:319-336).
- **Short AGENTS.md:** Kent keeps it ≤ 20 lines, checked in CI, with details in linked docs (L:mega-s03e02-wideo-kent); ours is 102 lines.
- **Fix docs, do not add corrections next to them** (L:aitl-l15-retrospektywa-wnioski-po-pierwszym-cyklu #6): AGENTS.md:10 says "one per run stage" (it is one queue); `context/foundation/roadmap.md` has an empty "Done".
- **A window into the factory:** progress, cost and agents' off-plan moves per pipeline, instead of story points (L:mega-qa-kent #8).

## Part B: Dead code and simplification

Added after the last package of the night lands.
