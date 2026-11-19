# Brief: PRD and roadmap for WB Factory (10x workflow)

## Goal

Turn what is already decided into the 10x workflow's foundation documents:
1. `context/foundation/prd.md`: a PRD describing the whole production WB Factory.
2. `context/foundation/tech-stack.md`: the agreed stack, in the format `/10x-bootstrapper` reads.
3. `context/foundation/roadmap.md`: an ordered set of vertical slices, each broken into concrete tasks.

Work in `~/Projects/wb-factory-prod`. It is a fresh rewrite with no code yet, so it is **greenfield**. The two old apps are reference only.

## What is already decided (sources of truth)

Read these first. Discovery is done, so **skip `/10x-shape`**. These files are the shaping notes.

| File | What it holds |
| --- | --- |
| `docs/01-analysis.md` | Process map, version comparison, target architecture (§3), tech stack (§4), domain rules to keep (§2.4), design input (§5) |
| `docs/03-design-decisions.md` | Approved structure, answers to the open questions, every design decision. **Wins over 01 where they differ** |
| `docs/04-accounts-and-signatures.md` | One shared account and signed actions. Replaces §3.7 of 01: no login, no roles. The access gate sits outside the app |
| `docs/05-review-triggers.md` | When reviews and rounds start. A push never starts a review |
| `docs/06-metrics.md` | Metrics |
| `prototype/README.md` and `prototype/` | **The prototype is approved by Alek (19 Nov 2026).** It is the UX spec |

Facts to keep:
- An internal tool for the Synergy team: one organisation, no multi-tenancy, nothing that blocks it later.
- Real agents only: never a fake mode.
- UI language is English.
- Review levels 5 (autofix) and 6 (learning) are in v1.

## Steps

1. **`/10x-init`.** Scaffold `context/`.
2. **`/10x-prd`.** Pass the docs above as raw notes. If the skill accepts only one input file, first write `context/foundation/source-notes.md`, a faithful condensation with a reference for each point, and pass that. The PRD covers the whole product. Every gap goes to `## Open Questions`; nothing is invented.
3. **Tech stack.** The stack is **already decided** (§4 of `01-analysis.md`) with these changes from the design phase:
   - Login and roles are dropped. That means no GitHub OAuth and no `@fastify/oauth2`.
   - Signatures come from Settings → Team.
   - The access gate sits outside the app.
   - Review triggers follow `05-review-triggers.md`.

   Produce `context/foundation/tech-stack.md` in the format `/10x-tech-stack-selector` writes, so `/10x-bootstrapper` can use it. Run the selector if that is the cleanest way to get the format, but answer its interview with the decided stack. Don't reopen choices. If a quality gate flags something, record it as a flag for Alek.
4. **`/10x-roadmap`.**
   - Vertical, user-visible slices in dependency order, with parallel slices marked.
   - Break **each slice into concrete tasks** that a developer or an agent run can pick up, and give each task a done-when check. If the roadmap schema has no room for tasks, put them in `context/foundation/roadmap-tasks.md` and link each slice to its tasks.
   - The first slice should be a thin end-to-end path: one PR, one review round, findings visible in the UI.

## Rules

- Alek is in this tab and answers the skills' questions directly. Ask in Polish, simply, and give a recommendation with every question.
- Documents are in English.
- **Don't change** anything in `docs/`, `prototype/`, `~/Projects/wb-factory` or `~/Projects/wb-factory-wb`.
- The old apps on :4300 and :4400 are the team's live apps. Use GET only, and never start a review, trial, implementer, push, merge or ClickUp action.
- Don't create issues, tasks or repos in GitHub or ClickUp. Ask Alek first.
- Ask before `git init` too.
- When done, give Alek a short summary in Polish:
  - the PRD in 5 sentences,
  - the list of slices,
  - which slice to start with,
  - the open questions.
