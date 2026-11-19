---
project: PR Review Agent
context_type: greenfield
created: 2026-11-19
updated: 2026-11-19
purpose: Single input file for /10x-prd. A faithful condensation of the design-phase documents, with a source for every point.
---

# PR Review Agent: source notes for the PRD

These notes condense what is already decided. They add nothing new. Every point names its source. Where sources disagree, the precedence rules below decide. What no source settles is listed under "Open questions", not filled in.

## Sources and precedence

| Key | File |
|---|---|
| [01 §x] | `docs/01-analysis.md` (analysis of the two prototypes, target architecture, stack) |
| [02] | `docs/02-design-brief.md` |
| [03 *heading*] | `docs/03-design-decisions.md` |
| [04] | `docs/04-accounts-and-signatures.md` |
| [05] | `docs/05-review-triggers.md` |
| [06] | `docs/06-metrics.md` |
| [07] | `docs/07-prd-roadmap-brief.md` |
| [PR] | `prototype/README.md` |
| [P:file] | `prototype/js/<file>` (the approved prototype as code) |
| [A] | Alek's answers in the PRD session, 2026-11-19 |
| [N] | Alek's product framing and final name, relayed in the PRD session, 2026-11-19 |

Precedence:
1. **The prototype is approved by Alek (19 Nov 2026) and is the UX spec** [07]. It also settles the 03 items marked "not reviewed yet" and "for Alek to check", because they are part of the approved prototype.
2. **03 wins over 01** where they differ [07].
3. **04 replaces 01 §3.7** (GitHub OAuth and three roles) [04, 07].
4. **05 replaces** 01's automatic review on every new commit, "at most 3 automatic rounds per PR", "each round reviews from scratch" and "cancel-and-replace on every new commit" [05].

Naming [N]: the product is **PR Review Agent** (slug and repository `pr-review-agent`; GitHub App and bot `pr-review-agent`). It is a PR review agent, not a "factory". The two old apps are referred to as **WB Factory (prototype)**. Product-name labels in the approved prototype change with the name: "Factory bot" → `pr-review-agent`, the "Factory" Settings group → General, "factory status chip" → status chip, "factory alerts task" → general alerts task.

Items in 01 that are **superseded** and must not reappear:
- Inbox page → the **Person** filter on Pull requests [03 Accounts].
- Members & roles, user menu, sign-in → **Team** list, no sign-in, no account menu [03 Accounts, 04].
- Lanes "Needs you" / "Needs author" → one lane, **Action needed** [03 Feedback].
- Cost estimates next to paid buttons → **only real spend is shown** [03 Feedback].
- Decisions Fix / Dismiss / Defer to task → **Implement / Reject / Defer to ClickUp** [03 Accounts, 04].
- "Protected paths" → **Sensitive files** [03 Feedback].
- A new commit cancels the running round → it does **not** [05].
- Findings posted to GitHub as a summary or inline comments → **one sentence, no link** [03 Answers #4].
- Merge through a person's own GitHub token → no personal sign-in exists [04, 07].
- "History" tab → **Timeline** [03 Accounts].
- Editable pipeline diagram → **read-only diagram plus structured settings** [03 Answers #2].

## Product facts (frontmatter inputs)

- **Project:** PR Review Agent [N].
- **Target:** any project (repository) the team works on, not only Workflow Builder. The first repository it serves is `synergycodes/workflowbuilder` (WB) [N].
- **Product type:** internal web application (single-page app in the browser) [02, 01 §4].
- **Users:** an internal tool for the Synergy team: one organisation, a few to a dozen developers plus a lead, the team's own repositories. No multi-tenancy, but nothing may block it later [01 header, 02, 07].
- **Volume:** tens of review rounds per day for one organisation; the production estimate is 10–25 rounds per workday [01 §3.1, §1.7].
- **Timeline:** "Robimy od razu" (we start right away). No week count and no deadline were given [A].
- **Working time:** built during working hours, not after hours [A].
- **UI language:** English [03 Answers #1].
- **Agents:** real agents only, never a fake mode [07, 00, 02].
- **Levels 5 (autofix) and 6 (learning) are in v1** [03 Answers #3, 07].

## Vision and problem

**The pain today** [01 §0, §1.7, §1.8, §5.4, Appendix]:
- Two vibe-coded prototypes, WB Factory (prototype), on :4300 and :4400, review the same repository independently. That doubles the spend (about $17/day combined) and gives different states for the same PR.
- In 5 days there were about 70 review rounds, about $87, roughly $1.30 and 2.5 minutes per round.
- 87% of rounds ran at level 1, so almost no finding was verified.
- People recorded **4 finding decisions in total** across both apps, and accepted **0 lessons**.
- 4 of 30 rounds failed at the 30-minute agent timeout, on the same big PRs in both versions. A failure costs a whole new round, because no single stage can be retried, and failed sessions record no cost.
- The PR author never hears about findings.
- Agents run on one person's subscription, every GitHub action uses one personal token, there is no record of who did what, and the state is free-text Polish strings.
- Both prototypes are tied to one repository: its sensitive paths, `main`, `pnpm` and the `apps|packages` layout are hard-coded, and the PR number is the primary key [01 §2.2 #8, §3.12 #9].

**What the data says the product must do** [01 §5.4, end]:
- The UI's main job is fast triage of findings.
- The decision step must be quicker than reading the PR on GitHub.

**Positioning, in Alek's words** [A]:
> "To narzędzie jest wsparciem, nie blokerem. User podejmuje decyzje kiedy agent nie potrafi ale docelowo ma działać sam."
> (English: "This tool is a support, not a blocker. The user makes decisions when the agent can't, but in the end it should work on its own.")

**What it is** [N]: a PR review agent for any project, configured per repository; Workflow Builder is the first repository, not the product's scope.

**How autonomy grows:** six review levels switch stages on gradually. Level 5 fixes by itself and level 6 learns from closed PRs. Insights → Trust ladder shows when a level has earned trust, including what level 5 would have done [01 §0, §5.5, 03 Answers #3].

## Users and personas

- **One shared account, one role.** Nobody signs in as themselves. Everything is visible and clickable for everyone [04].
- **Team members** are listed in Settings → Team with a name, a GitHub login and a ClickUp user. The list feeds signatures and the Person filter [03 Accounts, 04].
- **Jobs to be done** [01 §5.1]. With one role these are jobs, not permissions:
  - **PR author (developer):** "Tell me what to fix in my PR, with proof, before a human reviewer sees it." "Answer the agent's question about intent." "Let the agent fix the obvious things and show me the diff before it lands." Every PR, several times.
  - **Reviewer / lead:** "Show me which PRs need my decision now and why." "Decide quickly on each finding." "Merge when it is truly ready, with the checklist in front of me." "Approve changes to sensitive files." Daily, many PRs.
  - **Admin (often the lead):** "Keep cost under control (budget, pause, models)." "Raise the review level when the lower one has earned trust." "Change an instruction safely: draft → try on a PR → compare → activate or roll back." "Curate what PR Review Agent learns from closed PRs." Weekly.
  - **Observer / debugger (anyone):** "Why did this run fail or say this?" "What did the agent actually read?" "What did this cost?" Occasionally.
- **Who usually acts:** the PR author usually answers, decides and fixes ("usually Kasia (author)"). Sensitive files are usually approved by a teammate, not the author [03 States table, P:sim.js nextStep].
- **The bot, `pr-review-agent`:** the name under which the system's own actions are signed ("Factory bot" in the prototype) [04, N].

## Success criteria

**Primary** [A]:
- The team decides in the app: every merged PR with findings carries at least one signed decision or opinion. Baseline: 4 decisions in total across both old apps in 5 days [01 §0].

**Secondary** [06]:
- The five pilot metrics are measured from day one and shown with their sample size: agent work per PR, ready → merge (split by lane), cost per PR, not finished after 3 rounds, ready then changed by a person.
- No targets, trends or "X% better" for the pilot, because there are too few PRs. Time to merge varies from 19 h to 336 h with no process change [06].
- Side signal: the share of decided findings marked Implement, in Insights → Quality [06].

**Guardrails** (each is a decision in the sources):
- A push alone never starts a paid review [05].
- No new agent session starts once the daily budget is reached; rounds wait in the queue instead [03 States table, P:settings.js "checked before every agent session", 01 §3.11].
- Alerts never stop a round. The per-PR cost alert is a warning, not a cap [06].
- Nothing is pushed to a PR branch or merged without a person typing the PR number and signing, except level-5 autofix when all its conditions hold [04, 03 Signatures, P:settings2.js].
- Level 5 never pushes a change to a sensitive file by itself [03 States table, P:settings.js].
- The public PR never shows a link to the app or any finding. The only GitHub write besides push and merge is the one-sentence comment [03 Answers #4, 03 Feedback].
- Costs are always real spend, never estimates. A failed or timed-out session records its cost up to the failure [03 Feedback, 03 Pilot metrics].
- Real agents only; no fake or simulated mode exists [07].
- Nothing in the product's behaviour is specific to one repository; every repository-specific rule comes from that repository's settings [N, 01 §3.8].
- Code from a PR that PR Review Agent executes cannot reach the network, the app or any credential [01 §2.2 #5–6, §3.2, §3.4].

## Business Logic

PR Review Agent supports the team and never blocks it: agents review, verify and fix PRs by themselves, and a person decides only what an agent cannot, until it runs on its own.

Source: Alek's answer [A], quoted under "Vision and problem". The detailed domain rules below make that rule concrete.

### Review triggers [05]
- A push alone never starts a review.
- A round starts in only three ways:
  1. **The PR becomes ready in GitHub** (opened as ready, or switched from draft). Round 1 starts automatically, signed as pr-review-agent. Forks are excluded.
  2. **A person clicks Start review**, at any time, in any state, on any PR. Not signed, no limit. The timeline shows "Review started by hand".
  3. **PR Review Agent's own implementer pushed a fix** (Implement with agent, or level-5 autofix) and that commit is still the PR's head. The next round starts automatically, signed as pr-review-agent.
- The implementer records the commit it pushed. The automatic re-review starts only when the PR's head equals that commit exactly. If anyone pushes on top, nothing starts.
- Commits from someone's own editor start nothing. The PR shows "N new commits since last review" with Start review. This counts as the author's move.

### Chains and rounds [05, 03 Review triggers]
- A **chain** is the round that started it plus at most 2 automatic re-reviews after PR Review Agent's own fixes: 3 rounds. A chain starts with "ready for review" in GitHub or with Start review.
- After 3 rounds: "Automatic rounds used (3 of 3)" and Start review. Running out of rounds is not approval [01 §2.4, P:sim.js].
- Every new start (manual, or the PR switched to ready again) begins a new chain and resets the count. The Rounds card marks a second round 1 as "new chain" [03 Simplification].
- **Round 1 of every chain is a full review.** Rounds 2 and 3 are **fix checks**: they read the diff since the previous round and mark each finding decided as Implement as Resolved or Not resolved ("2 of 2 fixes resolved").
- **Only completed rounds count.** A failed round is retried from the failed stage and does not use up a round. A round cancelled by a person does not count.
- **A push during a running round** does not cancel it. Its result is labelled "Reviewed abc123 · 2 new commits since".
- **Closing a PR cancels its active run.**
- Round label: "Round 2 of 3 · started by pr-review-agent after fix abc123", "Round 1 of 3 · started by hand".
- An empty board does not auto-review everything [01 §2.4].

### Round stages and review levels [01 §1.3, P:data.js, P:settings2.js, 03]
- Stages of a round: **Checks** (CI and install), **Task** (linked ClickUp task), **Change type**, **Review**, **Verify**. Then the PR's state is computed.
- Levels (a higher level includes everything below it) [P:data.js]:

| Level | Name | Adds |
|---|---|---|
| 1 | Diff only | Review. Findings are not verified |
| 2 | With context | Checks, Task, Change type |
| 3 | Verified | Verify: each finding gets a verdict with quoted evidence and a reproduction |
| 4 | Fix on request | Implement with agent. Nothing is pushed without a person |
| 5 | Autofix | PR Review Agent fixes and pushes by itself when every autofix condition holds |
| 6 | Learning | After a PR closes, the analyst proposes lessons for a person to accept |

- The stepper shows Checks, Task and Change type as "off at level 1", and Verify as off at levels 1–2 [03 Prototype decisions].
- The level is frozen per run [01 §1.5]. Each repository has a default level for round 1; anyone can pick another level for one PR (not signed) [P:settings.js, 03 Signatures].
- Level settings inherit from the level below unless overridden: reviewer brief, most findings per round, most questions per round (0 = may not ask), review timeout in minutes, and models per role [P:settings2.js].
- Agent roles: **Reviewer** (reads the PR, writes findings and questions), **Verifier** (checks each finding, runs its reproduction), **Implementer** (fixes findings marked Implement), **Judge** (sets the change type when rules are not enough), **Analyst** (proposes lessons after a PR closes) [P:data.js].

### Findings [01 §1.3, §2.4, §5.5, 03]
- The reviewer reports at most 7 findings (cut to the level's limit), questions with 2–3 options and a recommended one, and up to 5 things it did not check [01 §1.3].
- **One term: Finding.** Severities: **Blocking**, **Worth fixing**, **Nit** [01 §5.4 #4, 03 Prototype decisions].
- **Verdicts:** Confirmed · Refuted · Not proven · Unchecked (level N). "Not checked at this level" is never shown as "not proven" [01 §5.5, §5.4 #3].
- **Verification rules** [01 §2.4]:
  - The verifier never sees the proposed fix.
  - Quotes must exist word for word in the file; no evidence means Not proven.
  - A reproduction script's result beats the agent's verdict (exit 0 = reproduced, exit 3 = does not happen), with one repair attempt.
  - Only the current round is verified, and the newest round decides.
- **Which findings need a decision:** only Blocking and Worth fixing ones that are not Refuted. Nits are "Optional" and never block [03 Prototype decisions, 01 §2.4].
- Findings rows show a badge only for a decision or a fix result. Verdicts and opinions are plain grey text. The findings filter appears only from 7 findings up [03 Simplification].

### Opinions and decisions [04, 03 Accounts]
- **Opinion:** Worth implementing or Not worth it, with an optional comment, signed. Many opinions per finding, listed with names.
- **Signed review:** a reviewer saves opinions on several findings at once ("Tomek's review: 2 worth implementing, 1 not worth it"). **Notify author** then appears.
- **Decision:** Implement, Reject (reason required) or Defer to ClickUp, signed. Anyone may decide. Each finding says who usually decides ("Usually decided by: Kasia (author)"). A decision on someone else's PR is recorded as such ("Rejected by Tomek (author: Kasia)"). The PR owner sees every opinion before deciding.
- "Implement" is the decision ("this must be fixed"). **Implement with agent** is the level-4 action that runs the implementer [03 Signatures].
- Deferring creates a follow-up ClickUp task [01 §1.5 #3, §3.6].
- **Opinions carry over:** in the next round, opinions move to the matching finding (same file and content), marked "from round 1".
- Answers to the reviewer's questions are fed into the next round's review [01 §1.5 #2].
- Questions come before findings: open questions are answered first [01 §2.4, P:sim.js].

### PR states, banners and lanes [03 States table, P:sim.js prState/nextStep]
State is evaluated in this order (first match wins) [P:sim.js]: merged / closed → a run is active (queued, fixing, fix check, round running) → stage failed → never reviewed (draft or not) → new commits since last review → patch ready → questions waiting → findings to decide → sensitive files → waiting for the fix (or automatic rounds used, when the chain has 3 rounds) → ready to merge.

| State | Next step banner | Main action | Lane |
|---|---|---|---|
| Draft | "Draft: review starts when the PR is ready for review" | Start review (optional) | Not reviewed |
| Never reviewed (e.g. a fork) | "Not reviewed yet" | Start review | Not reviewed |
| Queued, paused or budget reached | "Queued: paused by Tomek (release freeze)" / "Queued: daily budget reached ($50 of $50)" | Resume in the status chip | Agents working |
| Round 1 running | "Review starting: PR marked ready for review", live stepper, live cost | Cancel | Agents working |
| Fix check running | "Re-review starting: pr-review-agent pushed a fix (round 2 of 3)" | Cancel | Agents working |
| Questions waiting | "Answer 2 questions" | Answer (signed) | Action needed |
| Findings to decide | "Decide 4 findings · usually Kasia (author) · 1 review so far" | Opinions, signed review, Notify author; decisions (signed) | Action needed |
| Sensitive files changed | "Approve changes to 2 sensitive files" | Approve (not signed) / Send back (comment, signed) | Action needed |
| Waiting for the fix | "2 findings to implement · usually Kasia (author)" | Implement with agent (level 4+) | Action needed |
| Fixing | "Implementer is fixing 2 findings · started by Kasia" (or pr-review-agent) | Cancel | Agents working |
| Patch ready | "Patch ready: 2 of 2 fixed, reproductions pass" / "Autofix waiting: patch touches a sensitive file" | Push (PR number and signature) | Action needed |
| New commits since last review | "3 new commits since last review (abc123)" | Start review | Action needed |
| Automatic rounds used | "Automatic rounds used (3 of 3)" | Start review | Action needed |
| Stage failed | "Review stage timed out after 30 min. This round is not counted" | Retry from Review | Action needed |
| Ready to merge | "Ready to merge: checklist green at abc123" | Merge (PR number and signature) | Ready to merge |
| Merged or closed | "Merged by Kasia" plus the learning status at level 6 | None | Leaves the board |

- Action needed sort order: failed → questions → decide → sensitive files → patch → fix → new commits → rounds used [03 Prototype decisions].
- When the head moves, "Ready to merge" disappears, because merge is pinned to the reviewed commit. "New commits since last review" takes priority over findings still open from the reviewed commit; those stay usable, labelled "from abc123 · 3 commits behind" [03 Review triggers].
- A queued round waits for: PR Review Agent being paused, the daily budget being reached, or (prototype) both agent slots being busy (open question) [P:sim.js queueReason, 03 Open points].

### Sensitive files [03 Feedback, 03 Signatures]
- A sensitive file is one where any change needs a human OK, even after a clean review. Set per repository as a pattern with a reason.
- The first repository's (WB) rules today cover: public package exports, published package manifests, workflow-engine code, database migrations, deploy files, CI workflow files, and agent instruction files (`CLAUDE.md`, `.claude/`). These are WB's repository settings, not product defaults [03 Feedback, N].
- **Approve** is not signed ("Approved by hand"). **Send back** needs a comment for the author and is signed. Sent-back files keep the Sensitive files state with the banner "Sent back by Tomek: Kasia changes 2 sensitive files". A push by the author resets them to pending [03 Prototype decisions].

### Change type [01 §2.4, §5.5, P:settings.js]
- Three values: **Uses existing parts** (only listed paths change), **Changes behaviour** (everything else, and any PR above a size threshold), **One-way door** (listed paths; always needs a person).
- Path and size rules set the floor. The judge may only raise the change type, and is ignored when a person forces one. Limits per change type are applied after the model.

### Implement, patch and push [03, 01 §2.4, §5.6, PR flow C]
- Implement with agent: level 4+, signed (it leads to a push on someone's PR). The Implement decision form offers it as a checkbox, so one signature covers both. Below level 4 it is disabled with the reason and offers "Raise this PR to level 4" (not signed, logged as by hand).
- The implementer edits only, runs no shell, then the reproductions are re-run on the fixed code: "Patch ready: 2 of 2 fixed, reproductions pass" [01 §5.6 C].
- Patch tab: diff per file, Edit, Revert file, Revise with a note (Revise not signed) [PR flow C, 03 Signatures].
- Push: type the PR number and sign. Never forced; refused if the head moved [01 §2.4].

### Level 5 autofix [P:settings2.js, 03, 05]
At level 5 PR Review Agent starts the implementer and pushes by itself only when all of these hold. Otherwise it waits and says why on the PR:
1. Every finding that needs work is confirmed and fixed by the patch.
2. Every reproduction passes on the patched code.
3. The patch touches no sensitive file.
4. At most N automatic patches per chain (default 2; the only editable condition).
- At lower levels the same check runs silently and is logged. Insights → Trust ladder shows the shadow log ("level 5 would have fixed 3 of 8 PRs") [03 Answers #3].
- Autofix actions are signed as pr-review-agent [04].

### Merge [P:sim.js checklist, 01 §2.4, 03, 05]
- Merge checklist items: review covers the head commit; questions answered; no finding left undecided; nothing waiting for a fix; sensitive files approved (when the PR has any); CI green in GitHub; no "changes requested" in GitHub.
- On the PR page the checklist shows failing rows only ("Show all N"). All green is one line [03 Simplification].
- Merge is a squash merge pinned to the reviewed commit. The conditions are re-checked from fresh GitHub state at click time. Type the PR number and sign.
- After merge or close the PR leaves the board and sits in "Merged or closed in the last 7 days" under the board [03 Prototype decisions].

### Learning (level 6) [01 §2.4, §5.6 E, 03, PR flow E]
- After a PR closes, if its level has learning, the analyst runs automatically (signed pr-review-agent). Anyone can also click Run analyst (not signed).
- The analyst gets the closure (merged or closed, human comments excluding the PR author's own) and the case (findings with verdicts and decisions, answers, sensitive-file decisions). It proposes at most 5 lesson candidates and merges duplicates into existing ones (PR count goes up).
- A person edits, tries on a PR, accepts (signed) or rejects (signed) each candidate. A lesson needs at least 2 PRs: a candidate from one PR is shown, but Accept is disabled with the reason ("1 of 2 PRs: waits for one more").
- An accepted lesson is appended to the lessons file as a new version, and reviewers use it from the next round on.

### Instructions and experiments [01 §5.6 D, PR flow D, 03]
- Instruction files by scope (global, repository, level copy). Editor with a diff against the active version and a required note. Save as draft (not signed).
- Try on a PR: runs two trial rounds on the same commit (active vs draft) without changing the PR's state. Starting a trial is not signed ("Started by hand").
- Compare: findings only in A, only in B, in both; cost; the instruction diff.
- Activate a version or roll back: signed, with a before/after confirmation; recorded in the Audit log. Later runs pin the version they used.

### Repository-agnostic configuration (first-class) [N, 01 §3.5, §3.8, §2.2 #8, §3.12 #9, P:settings.js]
- The product reviews any repository the team connects. Workflow Builder (`synergycodes/workflowbuilder`) is the first, not a special case [N].
- A repository is a first-class thing with its own settings; PRs are identified by repository and number, not by number alone [01 §3.5].
- Everything the prototypes hard-coded for one repository comes from that repository's settings: default branch, install command, sensitive files, change-type rules (paths and size threshold), the ClickUp space, the default review level [01 §2.2 #8, §3.12 #9, P:settings.js].
- Instructions resolve global → repository → level copy; repository knowledge (the feature map) is repository-scoped [01 §3.8, §5.5].
- Forks are a per-PR property [01 §3.8].
- Board, Insights and metrics filter by repository; Insights → Trust ladder is per repository [03, 06].
- Settings are kept and changed only in the app (signed, in the Audit log), never read from files on a server; nothing else is needed so that more organisations can be added later [01 §3.8].

### Signatures [04, 03 Signatures]
- The signature is a field inside each action's own form or confirmation, prefilled with the last name used in this browser, chosen from Team. One signature covers a bulk action.
- **Signed:** opinions and signed reviews; decisions (Implement, Reject, Defer); answers to questions; Implement with agent; Send back (sensitive files); push and merge (with the typed PR number); every Settings change that lands in the Audit log (pause and resume, budget, models, levels, repository settings, team list, alert settings, activating or rolling back an instruction version, accepting or rejecting a lesson).
- **Not signed:** viewing; Start review; Retry; Cancel; Approve (sensitive files); starting a trial; Revise; Link a ClickUp task; changing the level for one PR; Raise this PR to level 4; Save as draft; Run analyst; dismissing an alert. None of them pushes, merges or changes settings in force.
- **Bot actions are signed as "pr-review-agent":** round 1 on ready for review, autofix, the automatic re-review after PR Review Agent's own fix, the analyst after close, alerts, and anything else the system does by itself.
- Every timeline and log entry shows who acted: a person's name, pr-review-agent, or "by hand".

### Notifications to people [04, 03, 06]
- **GitHub:** after each completed round the bot posts exactly "Ready for team member review (round N)". No link, no findings. Failed or cancelled rounds get no comment. It can be switched off in Settings → Integrations [03 Answers #4, 03 Feedback].
- **Notify author:** after a signed review, a ClickUp comment on the PR's task mentions the author, for example "@Kasia: Tomek marked 2 findings as worth implementing in PR #274". There is one ClickUp key, so the comment author in ClickUp is the key owner; the signer's name is in the text. A card under the banner previews it; "Not now" hides it [04, 03 Prototype decisions].
- A PR with no linked ClickUp task: Notify author shows the reason and a "Link a ClickUp task" action [03 Open points].

### Costs and budget [03 Feedback, 06, 01 §3.11]
- Only real spend is shown: a live counter on the PR ("$0.84 so far") and in Activity during a run; the final cost in Timeline, Run detail and Insights after it. No estimates before an action.
- Cost per PR counts every agent session on the PR at API rates, including when a run used a subscription. Trials and the analyst are reported separately. Tokens are kept next to the cost, never alone [06].
- Daily budget and pause: when paused or over budget, new rounds wait in the queue; running rounds finish. The budget is checked before every agent session [P:settings.js].

### Alerts [06, 03 Pilot metrics]
| Alert | Fires when | Clears when |
|---|---|---|
| A run failed | A stage timed out or crashed | A retry or a new review starts |
| Automatic rounds used | A chain used 3 of 3 rounds and a fix is still open | A new review starts |
| Cost of one PR | Real spend on the PR passes the threshold (default $5) | Never by itself; a person dismisses it |
| Daily budget | Spend passes the threshold (default 80%), and again at 100% | Spend is below the threshold again, or at midnight |

- Alerts speak only when something is wrong; nothing is sent when things go well or when a problem clears. They never stop a round.
- Delivery: a ClickUp comment on the PR's task, signed "pr-review-agent" in the text, naming the problem and the next step, with a link to the PR in PR Review Agent. Budget alerts, and alerts for PRs with no linked task, go to one general alerts task set in Settings → Alerts.
- Dashboard marks: a bell on the PR card, a secondary line in the PR's Next step banner, a strip above the board, a count on the status chip, the full list in Activity [03 Simplification].
- Dismiss is not signed; the timeline records "by hand". Alert settings are signed.

### Pilot metrics [06]
| # | Metric | Definition |
|---|---|---|
| 1 | Agent work per PR | Time agents actually worked on the PR, from the first "ready for review" to the end of the last stage, across every round, implementer run, fix check and retry. Queue time excluded. Failed or timed-out stages count |
| 2 | Ready → merge | From the first "ready for review" to the merge, split into Agents working (including queue), Action needed and Ready to merge |
| 3 | Cost per PR | Every agent session on the PR at API rates. Trials and the analyst are separate |
| 4 | Not finished after 3 rounds | PRs where a chain used all 3 automatic rounds while a fix was still open; shown next to PRs with more than 3 rounds in total |
| 5 | Ready, then changed by a person | Merged PRs that reached Ready to merge and then got a commit not pushed by PR Review Agent, or were merged in GitHub at another commit. Base-branch updates are ignored. A lower bound |

- Every number shows its sample size ("Based on 17 PRs merged"); below 10 PRs it adds "too few for firm conclusions". No trends, no "X% better". Filters: range (14 or 30 days), Author (the PR author), Repo.
- PR Timeline starts with a summary: ready for review, ready → merge, agents worked, waiting for people and merge, cost [03 Pilot metrics].
- Logged from day one so later metrics need no new tracking: every agent session in full (prompt, tool calls, files read, tokens, cost) and every GitHub event in raw form [06 Logging].

## Access control

- One shared account, one role. Nobody signs in as themselves; no per-user accounts; no "who are you" picker [04].
- Everything is visible and clickable for everyone. No option is hidden or disabled because of who you are [04].
- The app sits behind one shared access gate outside the app: a shared password, an SSO proxy or a VPN. The UI shows nothing about it: no sign-in screen, no account menu [04, 03 Accounts].
- Accountability comes from signatures, not identities (see Signatures) [04].
- Who acts in GitHub and ClickUp: PR Review Agent's own GitHub identity (bot name shown on public PRs) and one ClickUp key [03 Open points, 04, P:settings.js].

## Screens and functions (from the approved prototype)

### Global [03 Approved structure, 03 Simplification, PR]
- Top bar: PR Review Agent · Pull requests · Activity · Insights · Settings · search · status chip ("Running · $4.76 / $50 today", opens pause and budget; shows the active alert count). No account menu.
- The top-bar search opens the ⌘K palette: PRs, people, settings pages, actions.
- Keyboard shortcuts with a `?` help; light and dark theme [PR].
- Global screen rules: say it once; one filled button per screen; colour means state; show exceptions, not defaults; helper text behind ⓘ; the work starts by y≈380 at 1440×900; pills only for state; things that need nothing are smaller [03 Simplification].

### Pull requests board [03, PR]
- Lanes: Not reviewed · Agents working · Action needed · Ready to merge. Action needed is double width with an amber header and a count.
- Cards are three lines: title; #number · author · age; next step. Repo, level and round appear only when they differ from the default. Author names are never truncated. Ready to merge cards are two lines. Drafts are one-line rows under "N drafts".
- Filters: Person always visible (PRs the person authored or signed something on; default everyone). Repo, Forks, Level and Hide drafts sit in one Filters popover. All filters are in the address.
- "Merged or closed in the last 7 days", collapsed, under the board.

### PR detail [03, PR]
- Header: title plus one grey line. No state pill, no breadcrumb. Start review and the review level sit in a quiet header button with a popover, on every open PR.
- One Next step banner: its colour and title are the state. The live cost counter is in the banner while a run is live. Alerts show as a secondary line inside it.
- The stage stepper is full only while agents run or after a failure; otherwise one expandable round line with the "Round N of 3 · started by …" label.
- Tabs: Findings · Questions · Patch · Timeline. Total PR cost is in the Timeline summary.
- When a round finishes while its findings are on screen, the banner, checklist and stepper update at once; the findings list stays until "View new results".
- Retry: a successful retry keeps the round number and marks earlier stages "reused from the failed round". Cancel is an outline red button, never the primary.
- Decisions open a small inline form with the signature prefilled; Enter confirms; an Undo follows.
- Questions: answers are saved together, with one signature, from a sticky bar.

### Run detail [01 §5.2, 03, PR]
- From a PR or from Activity. Full-width mini pipeline above the stages. Stage list with readable output per stage; an agent transcript tab (what the agent read and did); cost per session; the instruction versions used. A failed run shows its cost up to the failure.

### Activity [03 Simplification, PR]
- Active alerts (including failed runs, with Retry), one In progress table (running and queued, with live cost and Cancel), and a collapsed "Finished today". Past alerts behind "Show N past alerts".

### Insights [03, 06, 01 §5.5]
- **Overview** (first tab): the five pilot metrics with sample sizes; ready → merge split by lane; a collapsed PR table; a collapsed "Not measured yet" list.
- **Cost:** real spend by day, repository, role and level.
- **Quality:** confirmed, refuted and accepted rates per level and instruction version, with a minimum-sample rule.
- **Trust ladder:** per repository, including the level-5 shadow log.

### Settings [03 Approved structure, 03 Prototype decisions, P:settings.js, P:settings2.js]
- Groups: General (Budget & status, Models, Team, Integrations, Alerts) · Repositories · Review (Review levels, Instructions, Pipeline) · Improve (Experiments, Learning) · System (Audit log).
- Every page starts with an "Affects:" line. A sticky save bar ("N unsaved changes") leads to a signed confirmation with a before/after table. Hints sit behind ⓘ. Inherited values are plain text with Override.
- **Budget & status:** pause or resume with a reason; daily budget; agent slots (rounds at the same time; open question).
- **Models:** the model per agent role, unless a review level sets its own.
- **Team:** name, GitHub login, ClickUp user per member.
- **Integrations:** GitHub connection (installation, repositories, event delivery health; the app's name is visible on public PRs), the after-round GitHub comment switch with its exact text, ClickUp connection with a connection test.
- **Alerts:** thresholds (failed, rounds, cost per PR, budget %) and the general alerts task [06].
- **Repositories:** the list of connected repositories; adding one is configuration only [N].
- **Repositories → repo:** default review level, default branch, install command (never run for forks), ClickUp space, sensitive files (pattern + reason), change-type rules (paths for Uses existing parts, size threshold, paths for One-way door).
- **Review levels:** the ladder 1–6, the default level for repositories without their own, a page per level with inheritance; at level 5 the four autofix conditions, where only "at most N automatic patches per chain" is editable.
- **Instructions:** list and editor (see Instructions and experiments).
- **Pipeline:** read-only diagram; click a stage to see its model, tools, prompt, output schema, timeout, attempts and the level where it turns on [01 §5.5, 03 Answers #2].
- **Experiments:** trials and Compare.
- **Learning:** candidates (Edit, Try on a PR, Accept, Reject), accepted lessons, closed-PR analyses with Run analyst.
- **Audit log:** every signed settings change and every change PR Review Agent made by itself, with actor, area and before/after; searchable.

## Key flows (approved, click by click in [PR])

- **A. PR ready → round 1.** A PR is marked ready in GitHub; round 1 starts by itself (pr-review-agent); the stepper shows Checks → Task → Change type → Review → Verify with live progress and cost; the round ends in Action needed (e.g. "Answer 1 question"); the Timeline shows bot entries including the posted GitHub comment.
- **B. Team review → author decides → merge.** A teammate answers questions (signed), gives opinions with keyboard shortcuts and saves a signed review, then clicks Notify author. The author filters by Person, decides (Implement / Reject with reason / Defer to ClickUp, signed), approves or sends back sensitive files, pushes from their editor ("2 new commits since last review" → Start review), sees "2 of 2 fixes resolved", then merges (typed number, signed). The PR leaves the board.
- **C. Implement with agent → push → fix check.** Implement with agent (signed) → Fixing → Patch tab (diff, Edit, Revert file, Revise with a note) → Push (typed number, signed) → pr-review-agent starts round 2 of 3, a fix check → "2 of 2 fixes resolved" → Ready to merge. Variants: level 5 autofix pushes by itself; autofix waiting on a sensitive file; automatic rounds used; a push during a running round changes nothing.
- **D. Change an instruction safely.** Edit → diff against the active version → note → Save as draft → Try on a PR → Compare → Activate version 4 (signed) → Audit log.
- **E. Learning after a PR closes.** Merge a level-6 PR → "Learning: Analyst is running" → "Analyst finished" → Settings → Learning: the candidate now has 2 PRs → Edit → Accept (signed) → appears as lessons file version 3 and in the Audit log.
- Also: status chip (pause with a reason, resume, budget), ⌘K, `?`, theme toggle, Retry from Review on a failed PR, Start review ▾ in any PR header.

## Non-goals (decided)

- **No sign-in, no per-user accounts, no roles, no permission checks in the app.** The access gate sits outside [04].
- **No Inbox page;** the Person filter replaces it [03 Accounts].
- **No multi-tenancy** in v1, but nothing that blocks it later [01 header, 07].
- **No fake or simulated agent mode,** ever [07].
- **No editable pipeline diagram;** read-only diagram plus structured settings [03 Answers #2].
- **No findings, opinions, decisions or links to the app in GitHub;** only the one-sentence comment [03 Answers #4].
- **No automatic review on push;** no quiet period before auto-review; no per-PR dollar cap; no cancelling a running round on a new commit [05 Dropped].
- **No cost estimates** before an action [03 Feedback].
- **No automatic retry** of a failed stage; Retry is a person's button [03 Signatures].
- **No trends or "X% better"** in Insights during the pilot [06].
- **Not measured in the first phase:** human-graded precision of findings, number of findings, tokens / lines of code / % of code from AI / number of PRs, reviewer minutes, median time to merge as proof, share of addressed findings, "changes requested" rounds and first-run CI, "X% better" after 2 weeks [06 Considered and not used].
- **Later (need about a month of data or E2E on every PR):** where problems are found (agent, person, CI, after merge); fix PRs and reverts within 14 days of merge; regressions caught by E2E. Shown as "Not measured yet" [06 Later].
- **No alerts when things go well** or when a problem clears [06].
- **Old apps are reference only;** nothing in WB Factory (prototype) is changed [07].
- **No behaviour specific to one repository;** Workflow Builder is configured like any other repository [N].

## Open questions (not settled by any source)

From 01 §6 that later documents did not answer:
1. **Model access and budget:** a Synergy organisation account for the model API (who owns it, monthly cap), or access through the company cloud? [01 §6 Q4]
2. **Where it runs:** is there an existing Kubernetes or cloud to deploy into? May repository code go to a model vendor's hosted sandboxes, or must execution stay on Synergy machines? [01 §6 Q5]
3. **Which repositories after WB** in the first 3 months? Do they differ in language, package manager, layout or default branch, and are any private? [01 §6 Q6, N]
4. **ClickUp linking rule:** is a task ID in the branch name or PR title an acceptable way to link a PR to its task (with today's search as a fallback)? Is ClickUp used by every team and repository? [01 §6 Q7]

From 03 "Open points":
5. **Agent slots:** is "Queued: both agent slots are busy" (two rounds at a time, set in Budget & status) a real production setting, or should Queued mean only paused or budget reached?
6. **Revise and "Raise this PR to level 4"** are unsigned in the prototype. Should they be signed?
7. **Nits:** should a nit be decidable at all, or only get opinions? (01 §2.4 said an accepted finding blocks even a nit; 03 says nits never block.)
8. ~~GitHub App name~~ **Resolved [N]:** `pr-review-agent`.
9. **PR with no linked ClickUp task:** the design shows the reason and a "Link a ClickUp task" action for Notify author. Confirm.
10. **ClickUp alert comment links to the app:** 03 marks it "Alek to confirm"; 06 (accepted 19 Nov) says it links. Confirm.

New gaps found while condensing:
11. **Timeline:** Alek said "start right away". How many weeks for v1, and is there a hard deadline? [A]
12. **"Support, not a blocker" vs the merge checklist:** may a person merge from the app when the checklist is not green (an override), or is the only way around it merging in GitHub directly? [A, P:sim.js]
13. **How the signer shows in GitHub:** with no personal sign-in, pushes and merges go out as the `pr-review-agent` GitHub App. How does the signer show up in GitHub (merge commit text, co-author line, nothing)? Does branch protection on each repository allow the app to merge? [04, 01 §3.6]
14. **Big PRs:** 4 of 30 rounds failed at the 30-minute review timeout on big PRs. Is the per-level review timeout plus Retry enough, or does v1 need a strategy for big PRs (review per package, a size cap)? [01 §1.8, §3.4, 03 Signatures]
15. **History from the old apps:** import anything from the two old apps (instruction versions, lessons, past rounds and decisions), or start empty with the current instruction files as version 1? [no source]
16. **Switching off the old apps:** when do :4300 and :4400 stop reviewing? Running all three on the same repository would triple the spend. [01 Appendix]
17. **Retention:** how long are full agent transcripts and raw GitHub events kept? [06 Logging, 01 §3.9]
18. **Access gate:** which one (shared password, SSO proxy or VPN), and who sets it up? [04]

## Forward: tech stack (not part of the PRD)

For `context/foundation/tech-stack.md`. The stack is decided in 01 §4, with these changes [07]:
- Login and roles are dropped: **no GitHub OAuth, no `@fastify/oauth2`** (and no session cookie for identity) [04, 07].
- Signatures come from Settings → Team; the last signer's name is remembered in the browser [04, 03].
- The access gate sits outside the app [04].
- Review triggers follow 05 (ready for review, Start review, own fix commit; never a plain push) [05].

Decided layers [01 §4]: TypeScript on Node 24 LTS; pnpm workspaces (`apps/web`, `apps/api`, `apps/worker`, `packages/core`, `packages/integrations`, `packages/agents`, `packages/db`); React 19 + Vite SPA with TanStack Router and TanStack Query; shadcn/ui (Radix + Tailwind) themed with WB tokens; compact stepper on the PR page and `@xyflow/react` read-only diagram on the Pipeline page; Fastify + Zod with OpenAPI from schemas, SSE for live updates; PostgreSQL 17 (managed); Drizzle ORM + drizzle-kit; pg-boss + an explicit run state machine in `packages/core`; Claude Agent SDK (TS) for reviewer, verifier and implementer, Anthropic TS SDK with structured outputs for judge and analyst, organisation API key in a Console workspace with a spend limit; rootless Docker per session (gVisor if available), repro scripts with `--network none`; git CLI via `execa` with a bare mirror and a worktree per run; GitHub App with `@octokit/app` and `@octokit/webhooks`; OpenTelemetry + pino + Sentry; Vitest (port P's 98 tests as acceptance tests on `packages/core`) and Playwright for key flows; Docker images on one VM with Docker Compose plus managed Postgres (Kubernetes if Synergy already runs it); a cloud secret manager or 1Password Connect.

Other forward-looking notes:
- Default models: reviewer and implementer `claude-opus-5-5`, verifier a different model (e.g. `claude-sonnet-5-5`), judge `claude-haiku-5-5` [01 §3.4].
- Agent hardening: per-role tool allow-lists (reviewer and verifier read-only in the worktree; implementer edits its own worktree only; nobody gets a shell); no settings sources and no MCP; no secrets in the agent's environment except the model key; repro scripts never run in the agent container; `maxTurns` and a per-session cost guard [01 §3.4].
- Events: webhooks plus a paginated reconcile poll every 10–15 min [01 §3.6].
- Orchestration: a run is a row, each stage a job keyed by run and stage; a stage writes output and status in one transaction; restart resumes at the next unfinished stage; human waits are states [01 §3.3].
- Prototype → shadcn/ui mapping and design tokens: [PR "UI pattern → shadcn/ui", "Design tokens"].

## Forward: roadmap and data model (not part of the PRD)

- Repository + RepositoryConfig (versioned) are first-class from the first slice, with WB as the first configured repository [01 §3.5, N].
- Core entities [01 §3.5] with these changes: no User/role entity → a Team member list (name, GitHub login, ClickUp user); every action carries a signature or "pr-review-agent" / "by hand"; Opinion as its own entity; FindingDecision values Implement / Reject / Defer [04, 03].
- Additions from 06: `PullRequest.ready_at`, `merged_at`, `closed_at`, `merge_sha`; `PrStateChange`; `HeadChange` (with `by_agent`, `is_base_merge`); `Chain`; `GitHubEvent` (raw); `Alert`; `AlertConfig` (versioned with the Audit log) [06].
- `prState()` and `nextStep()` in `prototype/js/sim.js` are the state table as code; start the build there [PR].
- Port P's domain rules and their 98 tests as acceptance tests with reason codes instead of Polish strings [01 §2.3].
- First slice (per [07]): a thin end-to-end path: one PR, one review round, findings visible in the UI.
