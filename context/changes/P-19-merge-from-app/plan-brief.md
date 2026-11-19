# Merge from the app — Plan Brief

> Full plan: `context/changes/P-19-merge-from-app/plan.md`

## What & Why

A green PR is merged from the app: type the PR number, sign, and the app squash-merges at the
reviewed SHA after re-checking every checklist row against fresh GitHub state (FR-054–056). The
same package adds the ClickUp end-to-end spec (S-06-T8).

## Starting Point

Core already has the checklist rows and the signed `merge` action; the DB never stored CI or
"changes requested", the gateway cannot merge, and the web has no merge button.

## Desired End State

The checklist shows real CI and review rows (fed by webhooks), "Checklist green at abc1234" when
all pass, Merge #N… opens a signed dialog, GitHub's refusal is shown verbatim, and a push removes
Ready to merge at once.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Route | `POST /api/prs/:repo/:number/merge { typedNumber, signedBy }` | Existing keying and signer field |
| CI storage | Columns on `pull_requests`, used only for the current head | A push clears CI at once |
| Double merge | PR row `FOR UPDATE` across check and GitHub call | One `squashMerge` call, simple |
| Refusal | 405/409/422 → 422 `merge_refused` with GitHub's message | Never bypasses protection |
| Dialog | Merge enabled on number + signer, not on a green checklist | Server re-check refreshes stale CI |
| e2e isolation | Own `merge-repo` and `clickup-repo` in the stack | Other specs keep their state |

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| 1. Gateway | merge, PR state, reviews | GitHub status mapping |
| 2. Merge route | fresh re-check, lock, trailer | Lock held over an HTTP call |
| 3. Fresh checklist | CI and review webhooks, force push | Event SHA → PR lookup |
| 4. Web | checklist line, Merge dialog | H9 conflicts with P-14 |
| 5. e2e merge | `merge.spec.ts` | Stack double reach |
| 6. e2e ClickUp | `clickup-link.spec.ts` | 15 s follow-up delay |

## Open Risks & Assumptions

- WB branch protection (OQ3) is unknown; the app only shows GitHub's reason.
- P-14 edits the same PR page files in parallel; merge conflicts are resolved at the end.
