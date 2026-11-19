// S-15-T2: level 5 autofix and the shadow log. When a round ends, the start rule decides whether
// the bot implements the findings that need work; when that patch is ready, the push rule decides
// whether the bot pushes it. Levels 3–4 run the same two checks and only write shadow entries.
import {
  autofixCheck,
  autofixMode,
  BOT,
  needsDecision,
  reason,
  type AutofixCheck,
  type AutofixInput,
  type Finding,
} from '@pra/core';
import {
  autofixStartOfRun,
  autoPatchesInChain,
  decideFindings,
  filesToPush,
  inArray,
  loadPrStateInput,
  patchOfRun,
  readRepositoryConfig,
  recordAutofixAttempt,
  recordShadow,
  schema,
  sendPushJob,
  startImplementer,
  succeededStageOutput,
  verificationsOfRun,
  type PatchWithFiles,
  type PrStateLoad,
} from '@pra/db';
import { autofixHolds } from './budget-gate.ts';
import type { RunHook, RunHookContext } from './hooks.ts';

/** The autofix start inputs core reads, from the PR as the round left it. */
async function startInput({ deps, run }: RunHookContext, load: PrStateLoad): Promise<AutofixInput> {
  const round = load.findingsRound;
  const [verifications, changeType, used] = await Promise.all([
    round ? verificationsOfRun(deps.db, round.id) : [],
    round
      ? (succeededStageOutput(deps.db, round.id, 'change_type') as Promise<{
          changeType?: AutofixInput['changeType'];
        } | null>)
      : null,
    run.chainId ? autoPatchesInChain(deps.db, run.chainId) : 0,
  ]);
  // The state table leaves the remedy out; the verifier's answer carries it.
  const remedies = new Map(verifications.map((v) => [String(v.findingId), v.remedy?.kind ?? null]));
  const findings: Finding[] = load.input.findings.map((f) => ({
    ...f,
    remedy: remedies.get(f.id) ?? null,
  }));
  return {
    level: run.level.number,
    fork: load.input.fork,
    // Pause and budget do not hold autofix: its implementer run queues behind them (S-10).
    paused: false,
    budgetReached: false,
    // A type a person forced wins (as in `raiseChangeType`): forcing One-way door after round 1
    // must hold autofix at the fix check, whose findings round still says otherwise.
    changeType: load.pullRequest.forcedChangeType ?? changeType?.changeType ?? null,
    findings,
    openQuestions: load.input.questions.filter((q) => !q.answered).length,
    commitsSinceReview: load.input.commitsSinceReview,
    autoPatchesInChain: used,
    maxAutoPatches: run.level.settings.autofixMaxPatches ?? undefined,
    chainRounds: load.input.chainRounds,
  };
}

/** On a completed round at level 3 or above: start autofix (level 5) or write the shadow. */
export const autofixOnRoundCompleted: RunHook = async (context) => {
  const { deps, run, pullRequest, repository } = context;
  if (run.kind !== 'round' || run.status !== 'completed') return;
  const mode = autofixMode(run.level.number);
  if (mode === 'off') return;
  const load = await loadPrStateInput(deps.db, pullRequest.id);
  // A later round finished meanwhile, or the PR closed: this round no longer decides.
  if (!load || load.pullRequest.state !== 'open' || load.reviewedRound?.id !== run.id) return;
  const check = autofixCheck('start', await startInput(context, load));
  // Nothing to fix is no decision: no attempt, no shadow entry.
  if (check.reason.code === 'nothing_to_fix') return;

  if (mode === 'shadow') {
    await recordShadow(deps.db, {
      pullRequestId: pullRequest.id,
      repositoryId: repository.id,
      runId: run.id,
      level: run.level.number,
      point: 'start',
      decision: check.allowed ? 'would_start' : 'would_wait',
      reasons: check.reasons,
      fixed: check.allowed ? check.findingIds.length : 0,
      total: check.findingIds.length,
    });
    return;
  }

  const attempt = {
    pullRequestId: pullRequest.id,
    chainId: run.chainId,
    roundRunId: run.id,
    point: 'start' as const,
  };
  if (!check.allowed) {
    await recordAutofixAttempt(deps.db, { ...attempt, outcome: 'waiting', reasons: check.reasons });
    return;
  }
  const started = await startImplementer(deps, {
    pullRequestId: pullRequest.id,
    startedBy: BOT,
    trigger: 'autofix',
    prepare: (tx) => decideAsBot(tx, load, check),
    afterInsert: async (tx, implementer) => {
      await recordAutofixAttempt(tx, {
        ...attempt,
        implementerRunId: implementer.id,
        outcome: 'started',
        reasons: check.reasons,
      });
    },
  });
  if (!started.started) {
    await recordAutofixAttempt(deps.db, {
      ...attempt,
      outcome: 'waiting',
      reasons: [started.reason],
    });
    return;
  }
  deps.logger.info({ runId: started.run.id, pullRequestId: pullRequest.id }, 'autofix started');
};

/**
 * The bot's Implement decision on the findings autofix fixes that nobody decided yet, signed by
 * `pr-review-agent`. A finding someone decided meanwhile refuses the start.
 */
async function decideAsBot(
  tx: Parameters<NonNullable<Parameters<typeof startImplementer>[1]['prepare']>>[0],
  load: PrStateLoad,
  check: AutofixCheck,
) {
  const work = new Set(check.findingIds);
  const ids = load.input.findings
    .filter((f) => work.has(f.id) && needsDecision(f).needed)
    .map((f) => Number(f.id));
  if (!ids.length) return;
  const rows = await tx
    .select({ id: schema.findings.id, version: schema.findings.version })
    .from(schema.findings)
    .where(inArray(schema.findings.id, ids));
  const seen = new Map(load.findings.map((f) => [f.id, f.version]));
  const decided = await decideFindings(tx, {
    pullRequestId: load.pullRequest.id,
    findingIds: ids,
    // The versions the check read: a finding decided since then is a conflict, not overwritten.
    expectedVersions: Object.fromEntries(rows.map((row) => [row.id, seen.get(row.id) ?? -1])),
    decision: 'implement',
    signedBy: null,
  });
  if (!decided.ok) return reason('autofix_findings_changed');
}

/** The push rule's view of a patch: its findings, fixes, reproductions and files to push. */
function patchResult(patch: PatchWithFiles) {
  const results = Object.values(patch.reproductions);
  return {
    baseSha: patch.baseSha,
    findingIds: patch.findingIds.map(String),
    fixedFindingIds: patch.fixedFindingIds.map(String),
    reproductions: { total: results.length, passed: results.filter((r) => r === 'pass').length },
    files: filesToPush(patch).map((file) => file.path),
  };
}

/**
 * On a completed implementer run at level 3 or above: push the bot's own patch when the push rule
 * allows it (level 5), or say why not; below level 5 a person's patch gets a shadow entry.
 */
export const autofixOnPatchReady: RunHook = async ({ deps, run, pullRequest, repository }) => {
  if (run.kind !== 'implementer' || run.status !== 'completed') return;
  const mode = autofixMode(run.level.number);
  if (mode === 'off') return;
  const [patch, start] = await Promise.all([
    patchOfRun(deps.db, run.id),
    autofixStartOfRun(deps.db, run.id),
  ]);
  if (!patch || patch.status !== 'ready') return;
  // Level 5 pushes only what it started itself; a person's patch waits for a person's push.
  if (mode === 'act' && !start) return;

  const check = autofixCheck('push', {
    level: run.level.number,
    fork: pullRequest.isFork,
    patch: patchResult(patch),
    headSha: pullRequest.headSha,
    sensitivePatterns: readRepositoryConfig(repository).value.sensitivePatterns,
    // The shadow has no automatic patches: a person made every patch.
    autoPatchesInChain: start?.chainId
      ? await autoPatchesInChain(deps.db, start.chainId, { exceptRunId: run.id })
      : 0,
    maxAutoPatches: run.level.settings.autofixMaxPatches ?? undefined,
    ...(await autofixHolds(deps.db)),
  });

  if (mode === 'shadow') {
    await recordShadow(deps.db, {
      pullRequestId: pullRequest.id,
      repositoryId: repository.id,
      patchId: patch.id,
      level: run.level.number,
      point: 'push',
      decision: check.allowed ? 'would_push' : 'would_wait',
      reasons: check.reasons,
      fixed: patch.fixedFindingIds.length,
      total: patch.findingIds.length,
    });
    return;
  }
  if (!check.allowed) {
    await recordAutofixAttempt(deps.db, {
      pullRequestId: pullRequest.id,
      chainId: start!.chainId,
      implementerRunId: run.id,
      patchId: patch.id,
      point: 'push',
      outcome: 'waiting',
      reasons: check.reasons,
    });
    return;
  }
  // The push job checks the push rule again on GitHub's fresh head; no signer means the bot.
  await sendPushJob(deps.queue, patch.id, null);
};
