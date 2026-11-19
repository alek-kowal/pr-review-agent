---
change_id: P-03r
title: Implementation review of P-03 (integrations and deploy)
status: implemented
created: 2026-11-19
updated: 2026-11-19
archived_at: null
---

## Notes

Work package P-03r: review P-03 against its plan (10x-impl-review format) and fix what the review
finds, one commit per finding. Plan: no. The report is
`context/changes/P-03-integrations-and-deploy/reviews/impl-review.md` (verdict NEEDS ATTENTION,
no critical, F1–F10 all fixed); P-03 `change.md` is now `impl_reviewed`.

## Decisions

- **Agent timeout**: `AgentRunInput.timeoutMs` is required (callers always know the stage
  timeout), and passing it fails with code `timeout`. A cancel or a timeout wins over an SDK error
  result, because that error is the SDK's answer to our own abort.
- **Git timeout**: every git command gets a deadline; `CliGitMirror` defaults to 15 minutes
  (enough for a large first clone), configurable with `timeoutMs`.
- **Stale GitHub installation**: on 401 or 404 with a cached installation id, drop the id and
  token and retry once. Once only, so a real 404 is not retried in a loop; safe because a 401 or
  404 means nothing was written.
- **Log rotation**: json-file, 5 files of 10 MB for web, api and worker (bounded at about 150 MB on
  the single VM).
- **Prices**: Fable 5.2 at $8/$40 and the Haiku 5.5 long-prompt rate (5× above 100K prompt tokens)
  from the claude-api skill table (cached 2026-11-03). The long-prompt rate is applied per request
  (per assistant message), as the API bills it. An unknown model is priced at $10/$50 (Fable 5.1,
  the highest first-party list price), so the cost guard never under-counts.
- **S3 `exists()`** keeps 404 = false: a HEAD response cannot tell a missing bucket from a missing
  key. Left to P-05 (HeadBucket once at start) instead of an extra request per call.
- **Report path**: `reviews/impl-review.md`, the 10x-impl-review default, instead of `review.md`
  named in the handoff.
- **Pricing commit**: the earlier session's partial commit (`0657530`) is completed by a separate
  `fix(agents)` commit instead of amending it, since amending a commit below HEAD needs a rebase.
- **Image check** done by hand: the api image answered `GET /health` 200 as uid 1000 against a
  throwaway database; the image and the database were removed afterwards.

## Needs Alek

- On the VM, the GitHub App key file must be readable by uid 1000 (`deploy/README.md`, 4ef1992).
