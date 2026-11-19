// S-14-T2: the push job. It re-reads the PR head from GitHub, checks the push rule, commits the
// patch as the App's bot on top of the reviewed commit and pushes it, never forced. The pushed
// commit is then the one FR-016 waits for: its `synchronize` starts the fix check (round N of 3).
import { BOT, canPush, member, reason, type Actor, type Reason } from '@pra/core';
import {
  activeRunOfPr,
  autofixStartOfRun,
  filesToPush,
  getPatch,
  getRunContext,
  getTeamMember,
  latestChainOf,
  markPatchPushed,
  markPushRefused,
  recordAutofixAttempt,
  recordTimelineEntry,
} from '@pra/db';
import { noreplyEmail, PUSH_COMMIT_MESSAGE, type GitIdentity } from '@pra/integrations';
import type { WorkerDeps } from '../deps.ts';
import { fetchMirror } from '../stages/worktree.ts';
import { expectOwnFix } from './chains.ts';

export type PushJob = { patchId: number; signedBy: string | null };

export type PushOutcome =
  { pushed: true; sha: string } | { pushed: false; reason: Reason | 'not_ready' };

/** Pushes one ready patch; a second delivery finds it pushed and does nothing. */
export async function handlePatchPush(deps: WorkerDeps, job: PushJob): Promise<PushOutcome> {
  const patch = await getPatch(deps.db, job.patchId);
  if (!patch || patch.status !== 'ready') return { pushed: false, reason: 'not_ready' };
  const found = await getRunContext(deps.db, patch.runId);
  if (!found) return { pushed: false, reason: 'not_ready' };
  const { pullRequest, repository } = found;
  const signer = job.signedBy ? await getTeamMember(deps.db, job.signedBy) : undefined;
  const actor: Actor = signer ? member(signer.id) : BOT;
  const files = filesToPush(patch);

  const fresh = await deps.github.getPullRequestState(
    repository.githubFullName,
    pullRequest.number,
  );
  const gate = canPush(
    { status: patch.status, baseSha: patch.baseSha, files: files.length },
    {
      number: pullRequest.number,
      state: fresh.state,
      fork: pullRequest.isFork,
      activeRun: await activeRunOfPr(deps.db, pullRequest.id),
    },
    pullRequest.number,
    fresh.headSha,
  );
  if (!gate.allowed) return refuse(deps, job, patch, actor, gate.reason);

  await fetchMirror({ deps, repository, run: found.run });
  const token = repository.installationId
    ? (await deps.github.getInstallationToken(repository.installationId)).token
    : undefined;
  const contents = [];
  for (const file of files) contents.push({ path: file.path, content: await blob(deps, file) });
  const result = await deps.gitMirror.pushPatch({
    repo: repository.githubFullName,
    branch: pullRequest.headRef,
    baseSha: patch.baseSha,
    files: contents,
    message: PUSH_COMMIT_MESSAGE,
    author: await deps.github.getBotIdentity(),
    coAuthor: signer ? await coAuthorOf(deps, signer) : null,
    // The patch's own time: a retry rebuilds the same commit instead of a second one.
    date: patch.createdAt,
    token,
  });
  if (!result.ok) {
    const now = await deps.github.getPullRequestState(
      repository.githubFullName,
      pullRequest.number,
    );
    return refuse(deps, job, patch, actor, reason('head_moved', { headSha: now.headSha }));
  }

  const pushed = await deps.db.transaction(async (tx) => {
    const row = await markPatchPushed(tx, patch.id, result.sha);
    if (!row) return false;
    if (job.signedBy === null) {
      await recordAutofixAttempt(tx, {
        ...(await autofixPushAttempt(deps, patch)),
        outcome: 'pushed',
        reasons: [reason('push_conditions_met')],
        sha: result.sha,
        at: row.pushedAt ?? undefined,
      });
    }
    await recordTimelineEntry(tx, {
      pullRequestId: pullRequest.id,
      actor,
      kind: signer ? 'patch_pushed' : 'autofix_pushed',
      params: { sha: result.sha, branch: pullRequest.headRef, patchId: patch.id },
      at: row.pushedAt ?? new Date(),
      sourceKey: `patch:${patch.id}:pushed`,
    });
    return true;
  });
  if (pushed) {
    // FR-016: this commit, and only this one, starts the next round of the chain by itself.
    const chain = await latestChainOf(deps.db, pullRequest.id);
    if (chain) await expectOwnFix(deps, chain.id, result.sha);
  }
  deps.logger.info({ patchId: patch.id, sha: result.sha }, 'patch pushed');
  return { pushed: true, sha: result.sha };
}

async function refuse(
  deps: WorkerDeps,
  job: PushJob,
  patch: { id: number; pullRequestId: number; runId: number },
  actor: Actor,
  refusal: Reason,
): Promise<PushOutcome> {
  await markPushRefused(deps.db, patch.id, refusal);
  await recordTimelineEntry(deps.db, {
    pullRequestId: patch.pullRequestId,
    actor,
    kind: 'patch_push_refused',
    params: { reason: refusal, patchId: patch.id },
    sourceKey: `patch:${patch.id}:push-refused:${Date.now()}`,
  });
  // S-15-T2: the bot's own push that GitHub's state refused leaves autofix waiting, with why.
  if (job.signedBy === null) {
    await recordAutofixAttempt(deps.db, {
      ...(await autofixPushAttempt(deps, patch)),
      outcome: 'waiting',
      reasons: [refusal],
    });
  }
  deps.logger.info({ patchId: patch.id, reason: refusal.code }, 'patch push refused');
  return { pushed: false, reason: refusal };
}

/** The push attempt of an autofix patch: its PR, chain, implementer run and patch. */
async function autofixPushAttempt(
  deps: WorkerDeps,
  patch: { id: number; pullRequestId: number; runId: number },
) {
  const start = await autofixStartOfRun(deps.db, patch.runId);
  return {
    pullRequestId: patch.pullRequestId,
    chainId: start?.chainId ?? null,
    implementerRunId: patch.runId,
    patchId: patch.id,
    point: 'push' as const,
  };
}

async function blob(
  deps: WorkerDeps,
  file: { path: string; blobKey: string | null },
): Promise<Uint8Array | null> {
  if (!file.blobKey) return null;
  const stored = await deps.blobStore.get(file.blobKey);
  if (!stored) throw new Error(`Patch file content is missing: ${file.path}`);
  return stored.body;
}

/** The signer's `Co-authored-by` identity: their GitHub noreply address, when GitHub knows them. */
async function coAuthorOf(
  deps: WorkerDeps,
  signer: { name: string; githubLogin: string },
): Promise<GitIdentity | null> {
  const user = await deps.github.getUser(signer.githubLogin);
  return user ? { name: signer.name, email: noreplyEmail(user.id, user.login) } : null;
}
