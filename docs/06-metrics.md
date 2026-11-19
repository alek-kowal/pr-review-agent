# Pilot metrics and alerts for PR review

Source: the team's metrics proposal for the WB pilot (19 Nov 2026). Alek accepted it on 19 Nov with two answers:
- alerts go to a ClickUp comment and a visual mark on the dashboard,
- the per-PR cost alert fires at $5.

Scope: PR review only (reviewer → verifier → implementer → person). It follows the round rules in `05-review-triggers.md`.

The prototype shows the metrics in **Insights → Overview**, the alerts in **Activity → Alerts** and **Settings → Alerts**, and a per-PR summary on the PR page's **Timeline** tab.

## The five metrics

| # | Metric | Definition | Data it needs |
|---|---|---|---|
| 1 | **Agent work per PR** | Sum of the time agents actually worked on the PR, from the first "ready for review" to the end of the last stage. It includes every round, implementer run, fix check and retry. Queue time is excluded. A failed or timed-out stage counts. | `StageExecution.started_at/finished_at` for every run of the PR |
| 2 | **Ready → merge** | From the first "ready for review" in GitHub to the merge. It is split into the board's three lanes: Agents working (including the queue), Action needed (waiting for people) and Ready to merge (waiting for the merge click). | `PullRequest.ready_at` and `merged_at`, plus a `PrStateChange` log (state, reason, head SHA, at) |
| 3 | **Cost per PR** | Every agent session on the PR, priced at API rates, also when the run used a subscription. Trials (Experiments) and the analyst after close are reported separately and not included. Tokens are kept next to the cost, never on their own. | `AgentSession.cost_usd` and tokens |
| 4 | **Not finished after 3 rounds** | PRs where a chain used all 3 automatic rounds while a fix was still open. Shown next to it: PRs with more than 3 rounds in total. A manual Start review begins a new chain, so the chain count alone would miss loops driven by people. | `Run.round_no`, chain id, state at chain end |
| 5 | **Ready, then changed by a person** | Merged PRs that reached Ready to merge, and after that either got a commit not pushed by the factory or were merged in GitHub at another commit. Commits that only merge the base branch into the PR ("Update branch") are ignored. This is a lower bound: it cannot see an approval without reading, or a fix made in a later PR. | A `HeadChange` log (before/after SHA, pusher, `by_factory`, `is_base_merge`), the merge SHA |

**Presentation rules**
- **Every number shows its sample size**, for example "Based on 17 PRs merged". Below 10 PRs it adds "too few for firm conclusions".
- **No trends and no "X% better".** The pilot has too few PRs for either. Time to merge varies from 19 h to 336 h with no change to the process.
- **The filters are range (14 or 30 days), Author and Repo.** Author uses the PR author, not the signature-based Person filter, because the metrics describe PRs.

## Logging

Everything below is logged now, so later metrics need no new tracking:
- **Every agent session in full:** prompt, tool calls, files read, tokens and cost.
- **Every GitHub event in its raw form:** pushes, state changes, reviews, comments and CI.

## Alerts

- **They speak up only when something is wrong.** Nothing is sent when things go well, or when a problem clears.
- **They never stop a round.** The $5 cost alert is a warning, not a cap, consistent with `05-review-triggers.md`, which dropped per-PR caps.

| Alert | Fires when | Clears when |
|---|---|---|
| A run failed | A stage timed out or crashed | A retry or a new review starts |
| Automatic rounds used | A chain used 3 of 3 rounds and a fix is still open | A new review starts |
| Cost of one PR | Real spend on the PR passes the threshold (default $5, about 3–4 average rounds) | Never by itself. A person dismisses it |
| Daily budget | Spend passes the threshold (default 80%), and again at 100% | Spend is below the threshold again, or at midnight |

**Delivery**
- **ClickUp comment** on the PR's task, posted with the factory's ClickUp key and signed "Factory bot" in the text.
  - It names the problem and the next step.
  - It links to the PR in WB Factory, because ClickUp is internal (unlike GitHub, where the comment never links to the app).
  - Budget alerts, and alerts for PRs with no linked task, go to one factory alerts task set in Settings → Alerts.
- **The dashboard:**
  - a bell and a red edge on the PR card,
  - a red pill on the PR page,
  - a strip above the board,
  - a count on the factory status chip (every page),
  - the full list in Activity.
- **Dismiss** is not signed. The timeline records "by hand".
- **Settings changes** to Alerts are signed, like every Settings change.

## Considered and not used in the first phase

The following come from the team's proposal. The design agrees with them:
- Precision of findings graded by a person.
  - Partly covered by metric 5.
  - The share of decided findings marked Implement stays in Insights → Quality as a side signal. It needs no extra work, because decisions are required before merge anyway.
- The number of findings.
- Tokens, lines of code, % of code from AI, and the number of PRs.
- Reviewer minutes.
- Median time to merge as proof of improvement.
- The share of addressed findings.
- "Changes requested" rounds and first-run CI.
- "X% better" after 2 weeks.

## Later

These need about a month of data, or E2E on every PR:
- Where problems are found: agent, person, CI, or after merge.
- Fix PRs and reverts within 14 days of merge.
- Regressions caught by E2E.

The prototype lists them on the Overview tab as "Not measured yet".

## Data model additions (on top of `01-analysis.md` §3.5)

- `PullRequest.ready_at` (first time), `merged_at`, `closed_at`, `merge_sha`.
- `PrStateChange` (pr_id, state, reason_code, head_sha, at).
- `HeadChange` (pr_id, before_sha, after_sha, pusher, by_factory, is_base_merge, at).
- `Chain` (id, pr_id, started_by, started_at, rounds_completed, ended_reason).
- `GitHubEvent` (raw webhook payload, type, delivery id, received_at).
- `Alert` (kind, key, pr_id, title, next_step, clickup_task, posted_at, status, ended_at, ended_by).
- `AlertConfig` (failed, rounds, cost_max, budget_pct, factory_task), versioned with the Audit log.
