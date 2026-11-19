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
import { autofixPushHold } from './autofix.ts';
import { expectOwnFix } from './chains.ts';

export type PushJob = { patchId: number; signedBy: string | null };

export type PushOutcome =
  { pushed: true; sha: string } | { pushed: false; reason: Reason | 'not_ready' };

/**
 * Pushes one ready patch. Safe to deliver again: a retry after the commit landed finds the
 * branch at the commit it builds and finishes the push; one after the patch was marked pushed
 * only repeats the hand-off to the fix check.
 */
export async function handlePatchPush(deps: WorkerDeps, job: PushJob): Promise<PushOutcome> {
  const patch = await getPatch(deps.db, job.patchId);
  if (patch?.status === 'pushed' && patch.pushedSha) {
    await handOff(deps, patch.pullRequestId, patch.pushedSha);
    return { pushed: false, reason: 'not_ready' };
  }
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
  // Only a moved head is worth a look: it may be this patch's own commit, pushed by an earlier
  // delivery of this job that stopped before it marked the patch.
  if (!gate.allowed && (gate.reason.code !== 'head_moved' || files.length === 0)) {
    return refuse(deps, job, patch, actor, gate.reason);
  }
  // The bot's own push asks the autofix push rule again: a pause, a budget, a lowered level or a
  // person's edit since the patch was ready stops it.
  if (gate.allowed && job.signedBy === null) {
    const hold = await autofixPushHold(deps, found, patch);
    if (hold) return refuse(deps, job, patch, actor, hold);
  }

  await fetchMirror({ deps, repository, run: found.run });
  const contents = [];
  for (const file of files) contents.push({ path: file.path, content: await blob(deps, file) });
  const commit = {
    repo: repository.githubFullName,
    baseSha: patch.baseSha,
    files: contents,
    message: PUSH_COMMIT_MESSAGE,
    author: await deps.github.getBotIdentity(),
    coAuthor: signer ? await coAuthorOf(deps, signer) : null,
    // The patch's own time: a retry rebuilds the same commit instead of a second one.
    date: patch.createdAt,
  };
  let sha: string;
  if (!gate.allowed) {
    if ((await deps.gitMirror.patchCommit(commit)) !== fresh.headSha) {
      return refuse(deps, job, patch, actor, gate.reason);
    }
    sha = fresh.headSha;
  } else {
    const token = repository.installationId
      ? (await deps.github.getInstallationToken(repository.installationId)).token
      : undefined;
    const result = await deps.gitMirror.pushPatch({
      ...commit,
      branch: pullRequest.headRef,
      token,
    });
    if (!result.ok && result.reason === 'remote_rejected') {
      return refuse(deps, job, patch, actor, reason('push_rejected'));
    }
    if (!result.ok) {
      const now = await deps.github.getPullRequestState(
        repository.githubFullName,
        pullRequest.number,
      );
      return refuse(deps, job, patch, actor, reason('head_moved', { headSha: now.headSha }));
    }
    sha = result.sha;
  }

  const pushed = await deps.db.transaction(async (tx) => {
    const row = await markPatchPushed(tx, patch.id, sha);
    if (!row) return false;
    if (job.signedBy === null) {
      await recordAutofixAttempt(tx, {
        ...(await autofixPushAttempt(deps, patch)),
        outcome: 'pushed',
        reasons: [reason('push_conditions_met')],
        sha,
        at: row.pushedAt ?? undefined,
      });
    }
    await recordTimelineEntry(tx, {
      pullRequestId: pullRequest.id,
      actor,
      kind: signer ? 'patch_pushed' : 'autofix_pushed',
      params: { sha, branch: pullRequest.headRef, patchId: patch.id },
      at: row.pushedAt ?? new Date(),
      sourceKey: `patch:${patch.id}:pushed`,
    });
    return true;
  });
  if (pushed) await handOff(deps, pullRequest.id, sha);
  deps.logger.info({ patchId: patch.id, sha }, 'patch pushed');
  return { pushed: true, sha };
}

/**
 * FR-016: this commit, and only this one, starts the next round of the chain by itself.
 * `expectOwnFix` is idempotent, so a redelivered job repeats it safely.
 */
async function handOff(deps: WorkerDeps, pullRequestId: number, sha: string): Promise<void> {
  const chain = await latestChainOf(deps.db, pullRequestId);
  if (chain) await expectOwnFix(deps, chain.id, sha);
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
