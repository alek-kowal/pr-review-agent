---
project: "PR Review Agent"
version: 1
status: draft
created: 2026-11-19
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: # TODO: mvp_weeks — see Open Questions
  hard_deadline: # TODO: hard_deadline — see Open Questions
  after_hours_only: false
---

# PR Review Agent

## Vision & Problem Statement

Synergy's developers and their lead review pull requests on the team's own repositories with two prototype review apps, WB Factory (prototype), that run side by side on the same repository and pay twice for the same work. In five days they ran about 70 paid review rounds (about $87, roughly $1.30 and 2.5 minutes each). 87% ran at the lowest level, so almost no finding was verified. 4 of 30 rounds died at the 30-minute timeout on big PRs and had to be paid for again from the start. The team recorded only 4 decisions on findings in total and accepted no lessons. The PR author never hears about findings, every action happens under one person's identity, nobody can tell who decided what, and both prototypes are hard-wired to a single repository.

The review only helps if acting on it is faster than reading the PR in GitHub, and if the tool supports the team instead of blocking it. Agents do the review, the verification and the fixing. A person steps in only where an agent cannot decide, and the agent earns more autonomy level by level, up to fixing and learning by itself. A shared, signed record of every opinion and decision lets the team trust the agent without personal accounts. The product is a PR review agent for any repository the team works on. Workflow Builder is the first repository it serves, not its scope.

## User & Persona

**Primary persona: Kasia, a developer on the Synergy team.** She is one of a few to a dozen developers plus a lead in one organisation. She reaches for PR Review Agent when her PR becomes ready for review. She sees what to fix, with proof, before a teammate reads the PR. She answers the agent's question about intent and decides each finding. She lets the implementer agent fix the obvious things after seeing the diff, then merges when the checklist is green. Several times a day she is also the teammate: she gives opinions on someone else's PR and saves them as a signed review. Everyone uses one shared account, so these are jobs, not permissions.

### Secondary persona

**The lead, who also runs the agent** (often the same person who reviews most PRs). Weekly, the lead:
- keeps cost under control (budget, pause, models),
- raises a repository's review level when the lower one has earned trust,
- connects and configures repositories,
- changes an instruction safely (draft → try on a PR → compare → activate or roll back),
- curates the lessons learned from closed PRs.

Anyone may also act as an **observer**: "Why did this run fail or say this? What did the agent read? What did it cost?"

## Success Criteria

### Primary
- **The team decides in the app.** Every merged PR with findings carries at least one signed decision or opinion recorded in PR Review Agent. Target: 100% of merged PRs with findings. Baseline: 4 decisions in total across both prototype apps in 5 days.

### Secondary
- The five pilot metrics are measured from the first PR and shown with their sample size:
  - agent work per PR,
  - ready → merge (split by board lane),
  - cost per PR,
  - not finished after 3 rounds,
  - ready, then changed by a person.

  No targets, trends or "X% better" are set for the pilot. There are too few PRs, and time to merge varies from 19 h to 336 h with no change to the process.
- Side signal: the share of decided findings marked Implement (Insights → Quality).

### Guardrails
- A push alone never starts a paid review.
- No new agent session starts once the daily budget is reached. Rounds wait in the queue instead.
- Alerts never stop a round. The per-PR cost alert is a warning, not a cap.
- Nothing is pushed to a PR branch or merged without a person typing the PR number and signing. The one exception is level-5 autofix, and only when all its conditions hold.
- Level 5 never pushes a change to a sensitive file by itself.
- The public PR never shows a link to the app, a finding, an opinion or a decision. The only write to the PR besides push and merge is the one-sentence comment.
- Costs shown are always real spend, never estimates. A failed, cancelled or timed-out session records its cost up to where it stopped.
- Real agents only. No fake or simulated agent mode exists.
- Code from a PR that the product executes cannot reach the network, the app or any credential.
- Nothing in the product's behaviour is specific to one repository.

## User Stories

### US-01: Round 1 starts when a PR becomes ready

- **Given** a non-fork PR in a connected repository is a draft
- **When** its author marks it "Ready for review" in GitHub
- **Then** round 1 starts by itself, signed by the bot (`pr-review-agent`), and the PR moves to Agents working with live progress and cost

#### Acceptance Criteria
- The stepper shows Checks → Task → Change type → Review → Verify; stages that are off at the PR's level are shown as off.
- When the round completes, the PR moves to Action needed or Ready to merge, and the bot posts exactly "Ready for team member review (round 1)" on the PR in GitHub.
- The PR's Timeline lists every bot entry, including the posted comment, and the round's final cost.
- A failed or cancelled round posts nothing to GitHub.

### US-02: A teammate answers questions and gives a signed review

- **Given** a PR in "Questions waiting" with findings to decide
- **When** Tomek picks an option for each question, signs once, then marks findings Worth implementing or Not worth it and saves them as one signed review
- **Then** the answers and opinions are recorded under his name, and a Notify author card previews the exact ClickUp comment for the author

#### Acceptance Criteria
- All answers are saved together with one signature.
- Opinions are listed under each finding with names and optional comments; one finding can have many.
- The review is summarised as "Tomek's review: 2 worth implementing, 1 not worth it".
- Notify author posts a comment on the PR's ClickUp task that mentions the author and names the signer. "Not now" hides the card.
- If the PR has no linked ClickUp task, the card shows the reason and "Link a ClickUp task".

### US-03: The author decides the findings

- **Given** Kasia filters the board by Person = Kasia and opens her PR in "Findings to decide"
- **When** she selects two findings and decides Implement, rejects another with a reason, and defers one to ClickUp, signing each action
- **Then** each decision is recorded with her signature, the deferred finding gets a ClickUp follow-up task, and the PR's next step updates in place

#### Acceptance Criteria
- She sees every opinion from others before deciding.
- One signature covers a bulk decision. Reject requires a reason. An Undo is offered right after.
- Each finding to decide shows "Usually decided by: Kasia (author)". A teammate may decide instead, and that is recorded as "Rejected by Tomek (author: Kasia)".
- Only Blocking and Worth fixing findings that are not Refuted need a decision. Nits are Optional and never block.

### US-04: Sensitive files get a human OK

- **Given** a PR changes files that match the repository's sensitive-file patterns
- **When** a teammate approves the changes, or sends them back with a comment
- **Then** approval is recorded as "Approved by hand", and a send-back is signed and shows "Sent back by Tomek: Kasia changes 2 sensitive files"

#### Acceptance Criteria
- The checklist item "Sensitive files approved" fails until the files are approved.
- After a send-back, the author's next push resets the files to pending.

### US-05: The author fixes in their editor and merges

- **Given** Kasia's PR has 2 findings decided as Implement
- **When** she pushes 2 commits from her editor
- **Then** no review starts. The PR shows "2 new commits since last review" with Start review, and "Ready to merge" is not shown.

#### Acceptance Criteria
- After she clicks Start review, the timeline shows "Review started by hand" and a new chain begins at round 1.
- After that round, the earlier Implement findings are shown as Resolved or Not resolved ("2 of 2 fixes resolved").
- When the checklist is green, Merge asks her to type the PR number and sign. The merge is a squash merge pinned to the reviewed commit, re-checked against the current GitHub state.
- The merged PR leaves the board and appears under "Merged or closed in the last 7 days".

### US-06: The implementer agent fixes, a person pushes, the agent checks its own fix

- **Given** a PR at level 4 or above has findings decided as Implement
- **When** Kasia runs Implement with agent (signed), reviews the patch, and pushes it after typing the PR number and signing
- **Then** the bot starts round 2 of 3 automatically, as a fix check, because the PR's head is exactly the commit it pushed

#### Acceptance Criteria
- Patch ready shows how many findings were fixed and whether the reproductions pass on the patched code.
- In the Patch tab she can edit a file, revert a file, or ask for a revision with a note before pushing.
- The push is never forced and is refused if the head moved.
- If anyone pushes on top of the agent's commit before the fix check starts, nothing starts automatically.
- Below level 4, Implement with agent is disabled with the reason and offers "Raise this PR to level 4".

### US-07: Level 5 fixes and pushes by itself, or waits with a reason

- **Given** a PR at level 5 whose round ended with confirmed findings that need work
- **When** every autofix condition holds
- **Then** the bot implements and pushes the fix without a click, and the fix check runs next

#### Acceptance Criteria
- If any condition fails, nothing is pushed and the PR says why, for example "Autofix waiting: patch touches a sensitive file".
- At most N automatic patches run per chain (default 2).
- At levels below 5, Insights → Trust ladder shows what level 5 would have done ("level 5 would have fixed 3 of 8 PRs").

### US-08: A chain runs out of automatic rounds

- **Given** a chain has completed 3 rounds and a fix is still not resolved
- **When** the third round completes
- **Then** the PR shows "Automatic rounds used (3 of 3)" with Start review, and an alert is raised

#### Acceptance Criteria
- Running out of rounds is never shown as approval.
- Start review begins a new chain at round 1 and clears the alert.

### US-09: A failed stage is retried from where it failed

- **Given** the Review stage of a round timed out after 30 minutes
- **When** anyone clicks "Retry from Review"
- **Then** the round reruns Review and the stages after it, reusing the results of the stages that succeeded, under the same round number

#### Acceptance Criteria
- The failed attempt does not count toward the chain's 3 rounds.
- The failed run shows its cost up to the failure, on the PR page and in Run detail.
- Reused stages are marked "reused from the failed round".
- Nothing retries by itself.

### US-10: Reviews wait while paused or over budget

- **Given** the lead paused PR Review Agent with the reason "release freeze", or the day's spend reached the daily budget
- **When** a PR becomes ready for review
- **Then** its round waits as "Queued: paused by Tomek (release freeze)" or "Queued: daily budget reached ($50 of $50)", and starts by itself once resumed, once the budget is raised, or the next day

#### Acceptance Criteria
- Rounds already running finish.
- The status chip on every page shows the state and today's spend against the budget.
- Pause, resume and budget changes are signed and appear in the Audit log.

### US-11: A push during a running round changes nothing

- **Given** a round is running on commit abc123
- **When** the author pushes 2 commits
- **Then** the round continues, and its result is labelled "Reviewed abc123 · 2 new commits since"

#### Acceptance Criteria
- No new round starts.
- "Ready to merge" is not offered for the new head.
- The findings from abc123 stay usable, labelled "from abc123 · 2 commits behind".

### US-12: Change an instruction safely

- **Given** the lead edits the reviewer's instruction file
- **When** they write a note, save a draft, try it on a PR, and compare the two trial rounds
- **Then** they can activate the new version (signed), and later rounds use it

#### Acceptance Criteria
- The editor shows a diff against the active version.
- A trial runs one round with the active version and one with the draft on the same commit, and leaves the PR's state untouched.
- Compare shows the findings only in A, only in B and in both, plus the cost and the instruction diff.
- Activation and rollback show a before/after confirmation and land in the Audit log.
- Each run records which instruction versions it used.

### US-13: Learning after a PR closes

- **Given** a PR at level 6 is merged
- **When** the analyst finishes
- **Then** Settings → Learning shows at most 5 lesson candidates from that PR, and a duplicate of an existing candidate raises that candidate's PR count

#### Acceptance Criteria
- The PR author's own comments are not used.
- A candidate from only one PR shows Accept disabled, with "1 of 2 PRs: waits for one more".
- Accepting (signed) adds the lesson to the lessons file as a new version, used from the next round on, and records it in the Audit log.
- Anyone can also run the analyst by hand on a closed PR.

### US-14: An alert when one PR gets expensive

- **Given** the cost alert threshold is $5 per PR
- **When** the real spend on a PR passes $5
- **Then** a ClickUp comment on the PR's task names the problem and the next step and links to the PR in PR Review Agent. The PR card gets a bell, the PR page shows the alert in its Next step banner, a strip appears above the board, and the status chip counts it.

#### Acceptance Criteria
- No round is stopped.
- The cost alert clears only when a person dismisses it (unsigned, "by hand").
- Alerts for PRs with no linked task, and budget alerts, go to one general alerts task.

### US-15: The lead reads the pilot metrics

- **Given** 17 PRs were merged in the last 30 days
- **When** the lead opens Insights → Overview, filtered to one repository
- **Then** each of the five metrics shows its value and "Based on 17 PRs merged", and ready → merge is split into Agents working, Action needed and Ready to merge

#### Acceptance Criteria
- Below 10 PRs, each number adds "too few for firm conclusions".
- No trends or deltas are shown.
- Filters: range (14 or 30 days), PR author, repository.

### US-16: A new repository is connected through settings alone

- **Given** PR Review Agent serves Workflow Builder
- **When** the lead connects another repository and fills its settings (default level, default branch, install command, sensitive files, change-type rules, ClickUp space)
- **Then** that repository's PRs appear on the board and are reviewed by its own rules, with no change to the product

#### Acceptance Criteria
- Nothing Workflow Builder-specific applies to the new repository.
- Repository-scoped instructions apply only to that repository.
- The board, Insights and the Trust ladder can be filtered by repository.

### US-17: Fork PRs are read-only

- **Given** a PR comes from a fork
- **When** it is opened or marked ready
- **Then** no review starts by itself, and the PR shows "Not reviewed yet" with Start review

#### Acceptance Criteria
- A review of a fork only reads the code: no install, no reproductions, no implementer, no push.

## Functional Requirements

### Repositories (repository-agnostic by design)
- FR-001: Team member can connect any repository the product's GitHub app can access and configure it in the app, with no change to the product. Priority: must-have
- FR-002: Team member can set per repository the default review level, default branch, install command, ClickUp space, sensitive files (pattern plus reason) and change-type rules (paths for Uses existing parts, a size threshold, paths for One-way door). Priority: must-have
- FR-003: Team member can keep instructions and repository knowledge per repository, resolved in the order global → repository → level copy. Priority: must-have
- FR-004: Team member can see PRs from all connected repositories, each identified by repository and number, and filter every list and metric by repository. Priority: must-have

### Pull requests board
- FR-005: Team member can see every open PR on a board with four lanes, Not reviewed, Agents working, Action needed and Ready to merge, with each PR in exactly one lane derived from its state. Priority: must-have
- FR-006: Team member can read on each card the title, number, author, age and a Next step line. Repository, level and round appear only when they differ from the default, and author names are never shortened. Priority: must-have
- FR-007: Team member can filter the board by Person (PRs the person authored or signed something on; default everyone), and by repository, forks, level and hiding drafts, with every filter kept in the page address. Priority: must-have
- FR-008: Team member can see Action needed sorted by urgency: failed, questions, findings to decide, sensitive files, patch ready, waiting for the fix, new commits, automatic rounds used. Priority: must-have
- FR-009: Team member can see drafts as one-line rows under "N drafts", Ready to merge cards as two lines, and PRs merged or closed in the last 7 days in a collapsed list under the board. Priority: must-have

### Global navigation and status
- FR-010: Team member can see on every page a status chip with the state (running, paused with who and why, budget reached), today's spend against the daily budget and the number of active alerts, and can pause, resume or change the budget from it. Priority: must-have
- FR-011: Team member can search PRs (number, title, author), people, settings pages and actions from one command palette, opened from the top-bar search or a keyboard shortcut. Priority: must-have
- FR-012: Team member can triage findings with keyboard shortcuts and open a list of shortcuts. Priority: must-have
- FR-013: Team member can switch between a light and a dark theme. Priority: must-have

### Starting reviews and rounds
- FR-014: The bot can start round 1 automatically when a PR that is not from a fork becomes ready for review in GitHub, either opened as ready or switched from draft. Priority: must-have
- FR-015: Team member can start a review by hand on any open PR, in any state, at any time, choosing the review level for that round. The start is unsigned, unlimited and shown as "Review started by hand". Priority: must-have
- FR-016: The bot can start the next round of a chain automatically only when the PR's head is exactly the commit PR Review Agent itself pushed as a fix. Priority: must-have
- FR-017: Team member can see "N new commits since last review" with Start review whenever the head moves after a review. A push by a person never starts a review. Priority: must-have
- FR-018: Team member can see a chain stop after 3 completed rounds with "Automatic rounds used (3 of 3)" and Start review. Any new start begins a new chain and resets the count. Priority: must-have
- FR-019: Team member can see rounds 2 and 3 of a chain check only the fixes, marking each finding decided as Implement as Resolved or Not resolved. Round 1 of every chain is a full review. Priority: must-have
- FR-020: Team member can see a round that was running when someone pushed finish normally, labelled with the reviewed commit and the number of commits since. Priority: must-have
- FR-021: Team member can see a round wait as Queued, with the reason, while PR Review Agent is paused or the daily budget is reached. It starts by itself when that clears. Priority: must-have
- FR-022: Team member can cancel a queued or running round, or a running implementer. Cancelling stops all agent work and spend for it, and a cancelled round does not count toward the chain. Priority: must-have
- FR-023: The bot can cancel a PR's active run when the PR is closed. Priority: must-have
- FR-024: Team member can retry a failed round from the failed stage. The retry reuses the results of stages that succeeded and keeps the round number, and the failed attempt does not count toward the chain. Priority: must-have
- FR-025: Team member can see each round labelled with its number in the chain and how it started, for example "Round 2 of 3 · started by pr-review-agent after fix abc123". A second round 1 is marked "new chain". Priority: must-have
- FR-026: Team member can start a review of a fork PR only by hand. A fork review only reads the code: no install, no reproductions, no implementer, no push. Priority: must-have
- FR-027: The bot can post exactly "Ready for team member review (round N)" on the PR in GitHub after each completed round, and nothing for failed or cancelled rounds. A team member can switch this off. Priority: must-have

### Round stages and review levels
- FR-028: The bot can run each round through the stages Checks (CI and install), Task, Change type, Review and Verify. Each stage is switched on or off by the round's review level (see Business Logic). Priority: must-have
- FR-029: The bot can link a PR to its ClickUp task and give the task to the reviewer as context. A team member can also link a task by hand (unsigned). Priority: must-have
- FR-030: The bot can set the change type (Uses existing parts, Changes behaviour, One-way door) from the repository's path and size rules. It may raise the type when the rules are not enough, but never lower it. A change type forced by a person wins. Priority: must-have
- FR-031: The bot can report, per round, up to the level's limit of findings (never more than 7) and questions, plus the things it did not check. Each finding has a severity (Blocking, Worth fixing, Nit), file and line, scenario and suggestion. Each question has 2–3 options with one recommended. Priority: must-have
- FR-032: The bot can give each finding, at level 3 and above, a verdict (Confirmed, Refuted, Not proven) with quoted evidence and, where possible, a reproduction. Below level 3, findings show "Unchecked (level N)". Priority: must-have
- FR-033: Team member can see live progress of a running round on the PR page and in Activity: the current stage, the stages that are off at this level, and the cost so far. Priority: must-have

### Questions
- FR-034: Team member can answer the reviewer's questions by picking an option or writing their own answer, and save all answers together with one signature. Priority: must-have
- FR-035: The bot can give the earlier answers on a PR to every later round of that PR. Priority: must-have

### Findings, opinions and decisions
- FR-036: Team member can read findings grouped by severity, each with file and line, verdict, evidence quotes, reproduction result, scenario and suggestion. Only decisions and fix results carry a badge, and a findings filter appears from 7 findings up. Priority: must-have
- FR-037: Team member can give a signed opinion on any finding: Worth implementing or Not worth it, with an optional comment. A finding can have many opinions, listed with names. Priority: must-have
- FR-038: Team member can save opinions on several findings as one signed review, for example "Tomek's review: 2 worth implementing, 1 not worth it". Priority: must-have
- FR-039: Team member can notify the author after a signed review, with a ClickUp comment on the PR's task that mentions the author and names the signer, after previewing its exact text. If the PR has no linked task, they see the reason and "Link a ClickUp task" instead. Priority: must-have
- FR-040: Team member can decide one or many findings with one signature: Implement, Reject (reason required) or Defer to ClickUp. An Undo is offered right after. Priority: must-have
- FR-041: Team member can see on each finding to decide who usually decides it, and can decide on anyone's PR. Such a decision is recorded with both names, for example "Rejected by Tomek (author: Kasia)". Priority: must-have
- FR-042: The bot can create a ClickUp follow-up task for each finding deferred to ClickUp. Priority: must-have
- FR-043: The bot can carry opinions over to the matching finding (same file and content) in the next round, marked "from round N". Priority: must-have
- FR-044: Team member can keep reading the current findings when a round finishes. The banner, checklist and stepper update at once, and the new findings appear only after "View new results". Priority: must-have
- FR-045: Team member can still use findings from an earlier reviewed commit after the head moved, labelled "from abc123 · N commits behind". Priority: must-have

### Sensitive files
- FR-046: Team member can approve changes to sensitive files (unsigned, recorded as "Approved by hand"), or send them back to the author with a comment (signed). Sent-back files stay pending until the author pushes again. Priority: must-have

### Implement with agent, patch and push
- FR-047: Team member can run Implement with agent (signed) on findings decided as Implement, on a PR at level 4 or above. The Implement decision form offers it as a checkbox, so one signature covers both. Priority: must-have
- FR-048: Team member can see Implement with agent disabled with the reason below level 4, and can raise that PR to level 4 (unsigned, recorded as by hand). Priority: must-have
- FR-049: Team member can see a finished patch with how many findings it fixed and whether the reproductions pass on the patched code. Priority: must-have
- FR-050: Team member can review the patch per file, edit a file, revert a file, or ask the implementer to revise it with a note (unsigned). Priority: must-have
- FR-051: Team member can push the patch to the PR branch after typing the PR number and signing. The push is never forced and is refused if the head moved. Priority: must-have

### Level 5 autofix
- FR-052: The bot can, at level 5, implement and push a fix by itself only when every autofix condition holds (see Business Logic). Otherwise it waits and says why on the PR. Priority: must-have
- FR-053: Team member can see, for levels below 5, what level 5 would have done on each PR (the shadow log), in Insights → Trust ladder. Priority: must-have

### Merge
- FR-054: Team member can see each PR's merge checklist, showing only failing rows and all green as one line. The checklist covers: the review covers the head commit; questions answered; no finding left undecided; nothing waiting for a fix; sensitive files approved (when there are any); CI green in GitHub; no "changes requested" in GitHub. Priority: must-have
- FR-055: Team member can merge a PR whose checklist is green by typing the PR number and signing. The merge is a squash merge pinned to the reviewed commit, and every condition is re-checked against the current GitHub state at that moment. Priority: must-have
- FR-056: Team member can see "Ready to merge" disappear as soon as the PR's head moves. Priority: must-have

### PR page
- FR-057: Team member can see on each PR one Next step banner with the state, what is needed, who usually does it and one main action. Its colour is the state, and active alerts show as a line inside it. Priority: must-have
- FR-058: Team member can switch between the Findings, Questions, Patch and Timeline tabs of a PR. Priority: must-have
- FR-059: Team member can start a review and pick its review level from the header of every open PR, and can change the level for one PR (unsigned). Priority: must-have
- FR-060: Team member can read a PR's Timeline. It starts with a summary (ready for review, ready → merge, agents worked, waiting for people and merge, total cost), then lists every event with who acted (a name, the bot, or "by hand") and the final cost of each finished run. Priority: must-have
- FR-061: Team member can see the full stage stepper while agents run or after a failure, and otherwise one expandable round line. Priority: must-have
- FR-062: Team member can see the learning status on a merged or closed PR at level 6. Priority: must-have

### Run detail
- FR-063: Team member can open Run detail from a PR or from Activity. It shows the run's pipeline, every stage with readable output, what each agent read and did, the cost of every agent session and the instruction versions used. A failed run shows its cost up to the failure, and stages reused by a retry are marked. Priority: must-have

### Activity
- FR-064: Team member can see in Activity the active alerts (including failed runs, with Retry), one table of running and queued runs with live cost and Cancel, and a collapsed list of runs finished today. Past alerts sit behind "Show N past alerts". Priority: must-have

### Alerts
- FR-065: The bot can raise an alert when a run fails, when a chain uses 3 of 3 rounds with a fix still open, when one PR's real spend passes the cost threshold, and when the day's spend passes the budget threshold and again at 100%. Each alert clears as defined in Business Logic. Priority: must-have
- FR-066: The bot can deliver each alert as a ClickUp comment on the PR's task, signed by the bot in the text, naming the problem and the next step and linking to the PR in PR Review Agent. Budget alerts and alerts for PRs without a task go to one general alerts task. Each alert also shows on the board card, the PR page, a strip above the board, the status chip and Activity. Priority: must-have
- FR-067: Team member can dismiss an alert (unsigned, recorded as "by hand"). The cost alert clears only this way. Priority: must-have
- FR-068: Team member can set the alert thresholds and the general alerts task (signed). Priority: must-have

### Insights
- FR-069: Team member can see in Insights → Overview:
  - the five pilot metrics, each with its sample size, and "too few for firm conclusions" below 10 PRs,
  - ready → merge split by lane,
  - a collapsed PR table and a collapsed "Not measured yet" list,
  - filters for range (14 or 30 days), PR author and repository.

  Priority: must-have
- FR-070: Team member can see in Insights → Cost the real spend by day, repository, agent role and level. Trials and the analyst are reported separately from PR cost. Priority: must-have
- FR-071: Team member can see in Insights → Quality the confirmed, refuted and accepted rates per level and instruction version, with a minimum-sample rule, and the share of decided findings marked Implement. Priority: must-have
- FR-072: Team member can see in Insights → Trust ladder, per repository, how each review level has performed, including the level-5 shadow log. Priority: must-have

### Settings
- FR-073: Team member can see on every Settings page what it affects, collect changes in a save bar ("N unsaved changes") and save them through one signed confirmation with a before/after table. Every saved change lands in the Audit log. Priority: must-have
- FR-074: Team member can pause PR Review Agent with a reason, resume it, and set the daily budget (each signed). Priority: must-have
- FR-075: Team member can set the model for each agent role (reviewer, verifier, implementer, judge, analyst) and see where a review level overrides it. Priority: must-have
- FR-076: Team member can add, edit and remove team members (name, GitHub login, ClickUp user). Priority: must-have
- FR-077: Team member can see the GitHub and ClickUp connection status, event delivery health and the repositories PR Review Agent can act on, test the ClickUp connection, and switch the after-round GitHub comment on or off. Priority: must-have
- FR-078: Team member can see the review level ladder 1–6 and set the default level for repositories without their own. They can edit each level's settings with inheritance from the level below: reviewer brief, most findings, most questions, review timeout, and models per role. At level 5 this includes the number of automatic patches per chain. Priority: must-have
- FR-079: Team member can view and edit instruction files by scope (global, repository, level copy), with a diff against the active version and a note. They can save a draft (unsigned), activate a version or roll back (signed), and see each version's history and how many runs used it. Priority: must-have
- FR-080: Team member can view the pipeline as a read-only diagram and open any stage to see its model, tools, prompt, output format, timeout, attempts and the level where it turns on. Priority: must-have
- FR-081: Team member can try an instruction draft or a lesson candidate on a PR (unsigned, "Started by hand"). This runs two trial rounds on the same commit, one per version, and leaves the PR's state untouched. The two rounds can be compared: findings only in A, only in B, in both, cost, and the instruction diff. Priority: must-have
- FR-082: Team member can search the Audit log of every signed settings change and every change PR Review Agent made by itself, with who, area and before/after. Priority: must-have

### Learning
- FR-083: The bot can run the analyst after a PR at level 6 closes. A team member can also run it by hand on any closed PR (unsigned). Priority: must-have
- FR-084: The bot can propose at most 5 lesson candidates per closed PR, merging a duplicate into the existing candidate and raising its PR count. Priority: must-have
- FR-085: Team member can edit a candidate, try it on a PR, reject it (signed), or accept it (signed) once it comes from at least 2 PRs. Before that, Accept is disabled with the reason. Priority: must-have
- FR-086: The bot can add an accepted lesson to the lessons file as a new version, used from the next round on. Priority: must-have

### Signatures and records
- FR-087: Team member can sign every signed action in its own form with a name from Team, prefilled with the last name used on this device. One signature covers a bulk action. Priority: must-have
- FR-088: The bot can keep every agent session in full (prompt, tool calls, files read, tokens, cost) and every GitHub event in its original form. Priority: must-have

## Non-Functional Requirements

- **Repository-agnostic:** connecting a new repository takes settings only. No product change and no per-repository code. Workflow Builder gets no behaviour that another repository could not get through its settings.
- **Live view:** an open page reflects a state change caused by an agent or by GitHub without a reload. While a run is active, the current stage and the cost so far stay visible the whole time. Content the reader is looking at never changes under them; new results wait behind an explicit "View new results".
- **Freshness:** a GitHub event (ready for review, push, close, merge, CI result) reaches the board within a target time. # TODO: freshness target — see Open Questions
- **Durability:** a restart of PR Review Agent loses no run, queued round or implementer job. An interrupted stage can be retried, and nothing stays "running" forever.
- **Cancel really stops:** after Cancel, the cancelled run causes no further spend and writes no further results.
- **Cost truth:** every agent session's real cost is recorded, including failed, cancelled and timed-out sessions, up to where they stopped. Shown costs never include estimates.
- **Budget:** no agent session starts after the day's spend has reached the daily budget.
- **Isolation:** code from a PR that is executed (install, reproductions) cannot reach the network, the app or any credential. Agents hold no team credentials beyond what they need to run.
- **Privacy toward public PRs:** nothing written to GitHub reveals the app's address, a finding, an opinion or a decision.
- **Accountability:** every action records who acted (a team member's name, the bot, or "by hand") and when. Every settings change records before and after values.
- **Reads never write:** opening or viewing any page changes no data.
- **Concurrent edits:** two people acting on the same PR at the same time never silently overwrite each other's decisions or opinions.
- **Complete logs:** every agent session and every GitHub event is kept in full from day one, so later metrics need no new tracking. # TODO: retention period — see Open Questions
- **Accessibility:** text and controls meet WCAG AA contrast, focus is always visible, and finding triage works by keyboard alone.
- **Layout:** at 1440×900, the work on every screen starts by y≈380.
- **Language:** all UI copy is English.
- **Organisation scope:** one organisation now. Adding a second organisation later requires no rework of existing data or settings.

## Business Logic

PR Review Agent supports the team and never blocks it: agents review, verify and fix PRs by themselves, and a person decides only what an agent cannot, until it runs on its own.

**Inputs.** The rule uses:
- each PR's moments in GitHub: ready for review, new commits and who pushed them, CI, "changes requested", close and merge;
- the repository's settings: default level, sensitive files, change-type rules;
- the active instructions and lessons, the PR's review level, the daily budget and pause state;
- the team's signed answers, opinions and decisions.

**Output.** Every PR gets one state. The state says what is needed next and who usually does it, puts the PR in a board lane, and sets which actions are offered.
- **Rounds.** A round starts only when the PR becomes ready, a person asks, or the agent checks its own fix. A chain has at most 3 completed rounds. Round 1 is a full review; later rounds check the fixes only.
- **Findings.** A finding needs a person only when it is Blocking or Worth fixing and not refuted.
- **Merge.** A merge from the app happens only at the reviewed commit, with the checklist green.
- **Autonomy by level.** Level 4 fixes on request. Level 5 fixes and pushes by itself when every autofix condition holds. Level 6 proposes lessons that a person accepts.

**How the user meets it.** The user meets this rule as the Next step banner and the board lane:
- Agents working means nobody needs to act.
- Action needed names the one thing a person must do, and who usually does it.
- Ready to merge means every checklist item passes at the reviewed commit.

Every action is recorded with a team member's signature, the bot, or "by hand".

### Review levels

| Level | Name | Adds |
|---|---|---|
| 1 | Diff only | Review. Findings are not verified |
| 2 | With context | Checks (CI and install), Task, Change type |
| 3 | Verified | Verify: each finding gets a verdict with quoted evidence and a reproduction |
| 4 | Fix on request | Implement with agent. Nothing is pushed without a person |
| 5 | Autofix | Fixes and pushes by itself when every autofix condition holds |
| 6 | Learning | After a PR closes, the analyst proposes lessons for a person to accept |

- A higher level includes everything below it.
- The level is frozen for a run.
- Each repository sets a default level for round 1, and anyone can pick another level for one PR.

### Rounds and chains
- **Starts.** A round starts in only three ways:
  1. The PR becomes ready for review in GitHub (not for forks). The bot starts round 1.
  2. A person clicks Start review. It is unsigned and unlimited.
  3. The PR's head is exactly the commit PR Review Agent pushed as a fix. The bot starts the next round.
- **Chains.** A chain is the round that started it plus at most 2 automatic re-reviews after PR Review Agent's own fixes. Every new start begins a new chain.
- **What counts.** Only completed rounds count. A failed round is retried from its failed stage and does not count. A cancelled round does not count.
- **Pushes and closing.** A push during a running round does not cancel it. Closing a PR cancels its active run.
- **Previous answers.** Earlier answers to the reviewer's questions are part of every later round.

### Verification and change type
- The verifier never sees the proposed fix.
- Quotes must exist word for word in the file. No evidence means Not proven.
- A reproduction's result beats the verifier's own verdict: reproduced means Confirmed, does not happen means Refuted. A broken reproduction gets one repair attempt.
- Only the current round is verified, and the newest round decides.
- Path and size rules set the change type's floor. The judge may only raise it, and is ignored when a person forces a type. A One-way door always needs a person. Limits per change type apply after the reviewer's output.

### PR states

States are checked in this order, and the first match wins: merged or closed → a run is active → stage failed → never reviewed → new commits since last review → patch ready → questions waiting → findings to decide → sensitive files → waiting for the fix (or automatic rounds used) → ready to merge.

| State | Next step banner (example) | Main action | Lane |
|---|---|---|---|
| Draft | "Draft: review starts when the PR is ready for review" | Start review (optional) | Not reviewed |
| Never reviewed (e.g. a fork) | "Not reviewed yet" | Start review | Not reviewed |
| Queued | "Queued: paused by Tomek (release freeze)" / "Queued: daily budget reached ($50 of $50)" | Resume in the status chip | Agents working |
| Round 1 running | "Review starting: PR marked ready for review" | Cancel | Agents working |
| Fix check running | "Re-review starting: pr-review-agent pushed a fix (round 2 of 3)" | Cancel | Agents working |
| Questions waiting | "Answer 2 questions" | Answer (signed) | Action needed |
| Findings to decide | "Decide 4 findings · usually Kasia (author) · 1 review so far" | Opinions, signed review, Notify author; decisions (signed) | Action needed |
| Sensitive files changed | "Approve changes to 2 sensitive files" | Approve (unsigned) / Send back (signed) | Action needed |
| Waiting for the fix | "2 findings to implement · usually Kasia (author)" | Implement with agent (level 4+) | Action needed |
| Fixing | "Implementer is fixing 2 findings · started by Kasia" | Cancel | Agents working |
| Patch ready | "Patch ready: 2 of 2 fixed, reproductions pass" / "Autofix waiting: patch touches a sensitive file" | Push (PR number and signature) | Action needed |
| New commits since last review | "3 new commits since last review (abc123)" | Start review | Action needed |
| Automatic rounds used | "Automatic rounds used (3 of 3)" | Start review | Action needed |
| Stage failed | "Review stage timed out after 30 min. This round is not counted" | Retry from Review | Action needed |
| Ready to merge | "Ready to merge: checklist green at abc123" | Merge (PR number and signature) | Ready to merge |
| Merged or closed | "Merged by Kasia", plus the learning status at level 6 | None | Leaves the board |

### Autofix conditions (level 5)
1. Every finding that needs work is confirmed and fixed by the patch.
2. Every reproduction passes on the patched code.
3. The patch touches no sensitive file.
4. At most N automatic patches per chain (default 2). This is the only editable condition.

At lower levels the same check runs silently and is recorded (the shadow log).

### Learning
- A lesson needs at least 2 PRs.
- The PR author's own comments are excluded from what the analyst reads.
- A person accepts every lesson. Nothing is learned without that.

### Alerts

| Alert | Fires when | Clears when |
|---|---|---|
| A run failed | A stage timed out or crashed | A retry or a new review starts |
| Automatic rounds used | A chain used 3 of 3 rounds and a fix is still open | A new review starts |
| Cost of one PR | Real spend on the PR passes the threshold (default $5) | Only when a person dismisses it |
| Daily budget | Spend passes the threshold (default 80%), and again at 100% | Spend falls below the threshold again, or at midnight |

- Alerts speak only when something is wrong. Nothing is sent when things go well or when a problem clears.
- Alerts never stop a round.

### Pilot metrics

| # | Metric | Definition |
|---|---|---|
| 1 | Agent work per PR | Time agents actually worked on the PR, from the first "ready for review" to the end of the last stage, across every round, implementer run, fix check and retry. Queue time is excluded; failed or timed-out stages count |
| 2 | Ready → merge | From the first "ready for review" to the merge, split into Agents working (including the queue), Action needed and Ready to merge |
| 3 | Cost per PR | Every agent session on the PR, priced at pay-per-use rates even when a subscription was used. Trials and the analyst are reported separately. Tokens are shown next to cost, never alone |
| 4 | Not finished after 3 rounds | PRs where a chain used all 3 automatic rounds while a fix was still open, shown next to PRs with more than 3 rounds in total |
| 5 | Ready, then changed by a person | Merged PRs that reached Ready to merge and then got a commit not pushed by PR Review Agent, or were merged in GitHub at another commit. Base-branch updates are ignored. This is a lower bound |

### Signed and unsigned actions
- **Signed** (a name from Team):
  - opinions and signed reviews;
  - decisions (Implement, Reject, Defer to ClickUp);
  - answers to questions;
  - Implement with agent;
  - sending sensitive files back;
  - push and merge, together with the typed PR number;
  - every settings change that lands in the Audit log: pause and resume, budget, models, levels, repository settings, the team list, alert settings, activating or rolling back an instruction version, accepting or rejecting a lesson.
- **Unsigned:** viewing, Start review, Retry, Cancel, approving sensitive files, starting a trial, Revise, linking a ClickUp task, changing the level for one PR, raising a PR to level 4, saving a draft, running the analyst by hand, dismissing an alert. None of them pushes, merges or changes settings in force.
- **Signed by the bot** (`pr-review-agent`): round 1 on ready for review, autofix, the automatic re-review after its own fix, the analyst after close, alerts, and anything else the product does by itself.

## Access Control

- **One shared account and one role.** Nobody signs in as themselves. There are no per-user accounts, no roles and no "who are you" picker.
- **Everything is visible and clickable for everyone.** No option is hidden or disabled because of who you are. Decisions on someone else's PR are never blocked; they are recorded as such.
- **Access gate.** The app sits behind one shared access gate outside the app: a shared password, a single-sign-on proxy or a VPN. The UI shows nothing about it: no sign-in screen and no account menu. Anyone who passes the gate is treated as a team member.
- **Accountability.** Accountability comes from signatures, not identities. A signature is a name picked from Settings → Team (name, GitHub login, ClickUp user) inside each signed action's own form. The bot signs the product's own actions.
- **External identities.** In GitHub, PR Review Agent acts as its own app, `pr-review-agent`, whose name is visible on public PRs. In ClickUp it uses one shared key, so the comment's author in ClickUp is the key owner, and the signer's name goes in the comment text.

## Non-Goals

### Functional non-goals
- **No sign-in, per-user accounts, roles or permission checks in the app.** The access gate lives outside the app, and signatures replace identities.
- **No Inbox page.** The Person filter on the board replaces it.
- **No editable pipeline diagram.** The diagram is read-only, and everything configurable is a structured setting.
- **Nothing beyond one sentence in GitHub.** No findings, opinions, decisions or links to the app go there. Findings live only in the app, because the app is private and the PRs are public.
- **No automatic review on push.** There is also no quiet period before auto-review, no per-PR dollar cap, and no cancelling a running round when a commit arrives.
- **No cost estimates before an action.** Only real spend is shown.
- **No automatic retry of a failed stage.** Retry is a person's button, because a very big PR usually fails again and a person decides whether to retry or split it.
- **No fake or simulated agent mode,** in any environment.
- **No behaviour specific to one repository.** Workflow Builder is the first repository, configured like any other.
- **Not measured in the first phase:**
  - human-graded precision of findings;
  - the number of findings;
  - tokens, lines of code, % of code from AI and the number of PRs;
  - reviewer minutes;
  - median time to merge as proof of improvement;
  - the share of addressed findings;
  - "changes requested" rounds and first-run CI.
- **Later, after about a month of data or end-to-end tests on every PR:**
  - where problems are found (agent, person, CI, after merge);
  - fix PRs and reverts within 14 days of merge;
  - regressions caught by end-to-end tests.

  These are listed as "Not measured yet".

### Non-functional non-goals
- **No multi-tenancy in v1.** One organisation, but nothing that blocks adding more later.
- **No trends, deltas or "X% better" in Insights during the pilot.** There are too few PRs for either.
- **No alerts when things go well** or when a problem clears.
- **The old apps stay untouched.** WB Factory (prototype) is reference only and nothing in it is changed.

## Open Questions

1. **Timeline.** Alek said "start right away". How many weeks is v1, and is there a hard deadline? — Owner: Alek. Block: no.
2. **"Support, not a blocker" vs the merge checklist.** May a person merge from the app when the checklist is not green (an override with a reason), or is merging in GitHub directly the only way around it? — Owner: Alek. Needed before: the merge work.
3. **How the signer shows in GitHub.** Pushes and merges go out as the `pr-review-agent` app. Should the signer appear in GitHub at all (merge commit text, co-author line, nothing)? Does each repository's branch protection allow the app to merge? — Owner: Alek. Needed before: the push and merge work.
4. **Model access and budget.** Is there a Synergy organisation account for the models (who owns it, monthly cap), or is access through the company cloud? — Owner: Alek. Block: yes, because real agents are needed from the first slice.
5. **Where it runs.** Is there an existing container platform or cloud to deploy into? May repository code go to a model vendor's hosted sandboxes, or must execution stay on Synergy machines? — Owner: Alek with infrastructure. Needed before: the first deployment for the team.
6. **Access gate.** Which gate (shared password, single-sign-on proxy or VPN), and who sets it up? — Owner: Alek with infrastructure. Needed before: the first deployment for the team.
7. **Repositories after Workflow Builder.** Which repositories in the first 3 months? Do they differ in language, package manager, layout or default branch? Are any private? — Owner: Alek. Needed before: connecting the second repository.
8. **ClickUp linking rule.** Is a task ID in the branch name or PR title an acceptable way to link a PR to its task, with today's search as a fallback? Is ClickUp used for every repository? — Owner: Alek. Needed before: the Task stage.
9. **Agent slots.** Is "Queued: both agent slots are busy" (two rounds at a time, set in Budget & status) a real setting, or should Queued mean only paused or budget reached? — Owner: Alek.
10. **Revise and "Raise this PR to level 4".** Both are unsigned in the approved prototype. Should they be signed? — Owner: Alek.
11. **Nits.** Should a nit be decidable at all, or only get opinions? The older analysis said an accepted nit blocks; the design says nits never block. — Owner: Alek.
12. **PR with no linked ClickUp task.** The design shows the reason and "Link a ClickUp task" for Notify author. Confirm. — Owner: Alek.
13. **Alert comments link to the app.** The design notes mark "Alek to confirm"; the accepted metrics document says they link (ClickUp is internal). Confirm. — Owner: Alek.
14. **Big PRs.** 4 of 30 prototype rounds failed at the 30-minute review timeout on big PRs. Is the per-level review timeout plus Retry enough, or does v1 need a strategy for big PRs (review per package, a size cap)? — Owner: Alek. Needed before: the pilot on real PRs.
15. **History from WB Factory (prototype).** Import anything (instruction versions, lessons, past rounds and decisions), or start empty with today's instruction files as version 1? — Owner: Alek.
16. **Switching off the prototype apps.** When do the apps on :4300 and :4400 stop reviewing? Running all three on the same repository would triple the spend. — Owner: Alek. Needed before: the pilot.
17. **Retention.** How long are full agent transcripts and original GitHub events kept? — Owner: Alek.
18. **Freshness target.** How quickly must a GitHub event (for example "ready for review") show on the board? — Owner: Alek.
19. **Settings group label.** The prototype's "Factory" Settings group (Budget & status, Models, Team, Integrations, Alerts) is renamed "General" to match the new product name. Confirm. — Owner: Alek.
