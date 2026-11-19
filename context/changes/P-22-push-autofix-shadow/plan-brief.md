# Push, autofix and shadow log — Plan Brief

> Full plan: `context/changes/P-22-push-autofix-shadow/plan.md`

## What & Why

A signed, never-forced push of the implementer's patch, followed by the automatic fix check; level
5 autofix that pushes by itself or waits with a reason; and the level 5 shadow log for lower
levels, so the team can judge when level 5 is safe.

## Starting Point

Patches, the implementer, the chain's own-fix hand-off (`expectOwnFix`) and the F-03 autofix rules
exist. Nothing can commit or push, the bot cannot sign decisions, and nothing calls the autofix
rules.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Push target | remote URL, never `origin` | the mirror remote would add mirror and force flags |
| Retry safety | deterministic commit (patch dates) + singleton job | a retry rebuilds the same SHA |
| FR-016 mark | `expectOwnFix` after the push | it already drives the own-fix round |
| Bot signer | nullable `signed_by` + `actor` on decision batches | no fake Team member |
| Core wrapper | `autofixCheck(point, input)` | `autofixDecision` already names the F-03 start rule |
| Act levels | level ≥ 5 acts, 3–4 shadow, 1–2 off | the ladder is cumulative; shadow needs verified findings |
| Paused autofix | run created, Queued by the gates | task text: pause, budget and slots still apply |
| Signer field | `signedBy` (as every signed route) | task's `signer` is the same thing |

## Phases at a Glance

| Phase | Delivers | Key risk |
| --- | --- | --- |
| S-14-T1 | `pushPatch`, `getUser`, bot identity | mirror remote flags |
| S-14-T2 | `canPush`, `patch.push` job | crash between push and record |
| S-14-T3 | push endpoint | — |
| S-14-T4 | push dialog | — |
| S-14-T5 | e2e push-recheck | stack remote must accept pushes |
| S-15-T1 | tables, `autofixCheck`, bot decisions | decision signer ripple |
| S-15-T2 | worker hooks | gates for implementer runs |
| S-15-T3 | banner and timeline | — |
| S-15-T5 | e2e autofix | level-6 e2e repo now autofixes |
| S-19-T9 | Trust ladder shadow log | — |

## Success Criteria (Summary)

- `push-recheck.spec.ts` and `autofix.spec.ts` pass; `pnpm verify` green after merging main.
