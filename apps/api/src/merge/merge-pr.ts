// S-12-T2: merge a PR from the app (FR-055). Every checklist row is re-checked on fresh GitHub
// state, then GitHub squash-merges at the reviewed commit as the App. The PR row stays locked for
// the whole check and call, so a second merge of the same PR waits and then finds it merged.
import { checklist, type ChecklistItem } from '@pra/core';
import {
  ciChecksOf,
  loadPrStateInput,
  lockActiveTeamMember,
  lockPullRequest,
  recordMergeRefused,
  recordPrMergedInApp,
  storeChangesRequested,
  storePrCi,
  type Db,
} from '@pra/db';
import type { GitHubGateway } from '@pra/integrations';
import { ApiErrorCode } from '../plugins/errors.ts';

export const SIGN_OFF_TRAILER = 'Signed-off-in-app-by';

export type MergeRequest = { pullRequestId: number; signedBy: string };

export type MergeOutcome =
  | { ok: true; sha: string; mergeSha: string; by: { id: string; name: string } }
  | { ok: false; status: number; code: ApiErrorCode; params: Record<string, unknown> };

const fail = (
  status: number,
  code: ApiErrorCode,
  params: Record<string, unknown> = {},
): MergeOutcome => ({ ok: false, status, code, params });

/** The squash commit's message: the PR description, then the signer's trailer. */
export function mergeMessage(body: string, signerName: string): string {
  const trailer = `${SIGN_OFF_TRAILER}: ${signerName}`;
  const description = body.trim();
  return description ? `${description}\n\n${trailer}` : trailer;
}

/** A failing row as the api sends it: the row and its reason code. */
const failingRow = (item: ChecklistItem) => ({ item: item.item, reason: item.reason });

/**
 * Re-checks and merges. Gateway failures throw (the transaction rolls back); GitHub's refusal is
 * an answer and is kept on the timeline.
 */
export async function mergePullRequest(
  deps: { db: Db; github: GitHubGateway },
  request: MergeRequest,
): Promise<MergeOutcome> {
  const { db, github } = deps;
  return db.transaction(async (tx) => {
    // Signer first, then the PR: the same lock order as the other signed PR writes.
    const signer = await lockActiveTeamMember(tx, request.signedBy);
    if (!signer) return fail(400, ApiErrorCode.SignerUnknown, { signer: request.signedBy });
    const pr = await lockPullRequest(tx, request.pullRequestId);
    if (!pr) return fail(404, ApiErrorCode.PrNotFound);
    if (pr.state !== 'open') return fail(409, ApiErrorCode.PrClosed, { state: pr.state });
    const load = await loadPrStateInput(tx, pr.id);
    if (!load) return fail(404, ApiErrorCode.PrNotFound);
    const fullName = load.repository.githubFullName;

    const fresh = await github.getPullRequestState(fullName, pr.number);
    if (fresh.state !== 'open') return fail(409, ApiErrorCode.PrClosed, { state: fresh.state });
    const reviewedSha = load.input.reviewedSha;
    if (reviewedSha && (fresh.headSha !== reviewedSha || pr.headSha !== reviewedSha)) {
      return fail(409, ApiErrorCode.HeadMoved, { reviewedSha, headSha: fresh.headSha });
    }

    const [ci, changesRequestedBy] = await Promise.all([
      github.getCiStatus(fullName, fresh.headSha),
      github.listChangesRequested(fullName, pr.number),
    ]);
    const checks = ciChecksOf(ci);
    // Stored even when the merge stops here, so the page shows what this check saw.
    await storePrCi(tx, pr.id, { sha: fresh.headSha, checks });
    await storeChangesRequested(tx, pr.id, changesRequestedBy);
    const rows = checklist({
      ...load.input,
      headSha: fresh.headSha,
      ci: checks,
      changesRequestedBy,
    });
    if (!rows.ok || !reviewedSha) {
      return fail(409, ApiErrorCode.MergeNotReady, {
        items: rows.items.filter((item) => !item.ok).map(failingRow),
      });
    }

    const result = await github.squashMerge({
      fullName,
      number: pr.number,
      sha: reviewedSha,
      title: `${pr.title} (#${pr.number})`,
      message: mergeMessage(pr.body, signer.name),
    });
    if (!result.merged) {
      await recordMergeRefused(tx, {
        pullRequestId: pr.id,
        memberId: signer.id,
        sha: reviewedSha,
        status: result.status,
        message: result.message,
      });
      return fail(422, ApiErrorCode.MergeRefused, {
        status: result.status,
        message: result.message,
      });
    }
    await recordPrMergedInApp(tx, {
      pullRequestId: pr.id,
      memberId: signer.id,
      sha: reviewedSha,
      mergeSha: result.sha,
    });
    return {
      ok: true,
      sha: reviewedSha,
      mergeSha: result.sha,
      by: { id: signer.id, name: signer.name },
    };
  });
}
