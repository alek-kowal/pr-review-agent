# Brief: analysis of WB Factory before a production rewrite

## Goal

Alek (developer at Synergy Codes) wants to rewrite WB Factory as a production app. Both current versions are vibe-coded prototypes. Before any design or code, we need one analysis that answers:

1. **What the factory does**: the full process, step by step.
2. **Which of the two versions is the better base** for production, and why.
3. **What architecture fits this process best.**
4. **What tech stack to use**, with reasons and the alternatives you rejected.
5. **Input for the design phase.** The next step is UI/UX design. Alek wants an extremely intuitive UI with great UX: clear steps, and an admin view where every element sits where a user would expect it.

## The two versions

| | `~/Projects/wb-factory` | `~/Projects/wb-factory-wb` |
| --- | --- | --- |
| What it is | Plain code (TypeScript, Node, SQLite) | The same PR-review factory rebuilt on Workflow Builder (`@workflowbuilder/sdk` 3.0.0 editor, `@workflowbuilder/temporal` 0.3.0 engine on Temporal). The pipeline is a diagram (`factory.workflow.json`, `learning.workflow.json`) |
| Live app | http://localhost:4300 | http://localhost:4400 (Temporal UI on :4434) |
| Docs | `src/`, `diagram/`, `knowledge/` | `README.md` (start here: pages, routes, env vars, costs), `src/`, `screenshots/` |

Workflow Builder is Synergy Codes' own product, so "built on our product" may count as a strategic reason. Say how much weight you give it and why.

Shared domain, in short: GitHub PR board → AI review round (a reviewer agent finds issues, then a verifier agent checks each finding) → a human decides per finding → optional ClickUp task → optional implementer agent → push/merge behind confirmation pages. There are six review levels; level 5 is autofix (`src/autofix.ts` and `src/server/autofix.ts`). After a PR closes, an analyst agent proposes lessons, which update the instruction files. Agents run as `claude -p` on the logged-in user's Claude subscription. Check this summary against the code. Don't trust it.

## Hard rules

- **Read-only.** Don't edit, move or delete anything in either repo. Write only to `~/Projects/wb-factory-prod/docs/`.
- **Both servers are the team's live apps on real PRs.** Don't restart or stop them. Don't press anything or send POSTs that start a review, trial, analyst, implementer, push, merge or ClickUp task: these spend money and act on real PRs. GET requests to read pages and `/api/*` JSON are fine.
- Never use `FAKE_AGENTS=1` or `AUTO_REVIEW=0`, and don't propose fake mode.
- Don't print secrets. `.env` values stay unread; variable names are fine.
- Don't ask questions mid-task, because nobody is watching this pane. Record assumptions and put questions under "Open questions".
- Use subagents for the bulk reading (both `src/` trees, tests, diagrams, knowledge files) and keep the conclusions.

## Output

Write `~/Projects/wb-factory-prod/docs/01-analysis.md` in English, with these sections:

1. **Process map.** Actors (people, agents, external systems), triggers, every stage with its inputs and outputs, human decision points, states a PR and a run move through, what costs money and how much (from the README and the code), and failure and retry paths. Add a Mermaid diagram if it helps.
2. **Version comparison.** A table on: domain coverage, code size (rough LOC per area), structure and coupling, persistence, durability and restarts, observability, testability and existing tests, how much is genuinely reusable, the Temporal/Workflow Builder dependency (benefit vs. operational cost), and the vibe-coding debt you found (with `file:line` examples). End with a clear verdict: which version to base the rewrite on, or which concepts to take from each.
3. **Target architecture.** Components and their boundaries, workflow/orchestration engine, agent execution, data model (core entities), integrations (GitHub App vs. token, webhooks vs. polling, ClickUp), auth and roles, multi-user and multi-repo, deployment, secrets, and observability/cost tracking. Call out the production blockers in the current approach. Example: running agents as `claude -p` on one person's subscription. Is that acceptable for a team tool, and what replaces it (Claude API, Agent SDK, other)?
4. **Tech stack.** A recommendation per layer with a one-line reason, plus the strongest alternative and why it lost. Favour boring, well-supported choices. Note the fit with Synergy, the Workflow Builder product and a TypeScript team.
5. **Input for design.**
   - User roles and their main jobs to be done.
   - An inventory of every screen and admin element in both versions: what it shows or does, its route, and where it lives now.
   - Current UX problems you can see (use `screenshots/` and live GET pages).
   - A proposed information architecture: top-level navigation, what goes in the admin area, and how it is grouped.
   - The 3–5 key flows written as numbered steps. Mark each step as "user does" or "system does".
6. **Open questions for Alek.** Only the ones whose answers change the architecture or the design.

Keep it scannable: tables and short paragraphs, no filler. When finished, reply in the pane with only the file path and a 5-sentence summary.
