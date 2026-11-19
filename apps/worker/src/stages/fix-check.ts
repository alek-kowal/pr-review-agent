// The stages of a fix check, rounds 2 and 3 of a chain (S-07-T3, FR-019): `fix_diff` collects the
// diff since the previous round and the findings decided Implement, `check_fixes` asks the
// reviewer in fix-check mode whether each is resolved, and `reproductions` reruns the scripts
// Verify kept for them. None of them writes new findings.
import { checkFixes, type FixCheckFinding, type FixStatus } from '@pra/agents';
import { runModel } from '@pra/core';
import { fixChecksOfRun, fixTargetsOfRun, reproductionScripts, type FindingRow } from '@pra/db';
import type { ChangedFile } from '@pra/integrations';
import type { SessionRecord, StageContext, StageExecutor, StageResult } from './stage.ts';
import { keepRun, reproduce, type ReproRun } from './verify.ts';
import { fetchMirror, runWorktree } from './worktree.ts';

export const FIX_CHECK_MAX_TURNS = 60;
export const FIX_CHECK_MAX_COST_USD = 3;

/** Stored for a finding whose reproduction still shows the bug on the fix head. */
export const STILL_REPRODUCES_REASON = 'The reproduction Verify kept still shows the bug.';

export type FixDiffOutput = {
  /** The previous round's reviewed SHA; null when the chain has no completed round. */
  fromSha: string | null;
  toSha: string;
  files: ChangedFile[];
  findings: { findingId: number; ordinal: number; title: string; file: string }[];
};

export type CheckFixesOutput = {
  fromSha: string;
  toSha: string;
  checked: number;
  resolved: number;
};

export type ReproductionsOutput = {
  /** False for a fork PR: its code is read, never run. */
  runScripts: boolean;
  /** Findings decided Implement with a script from Verify. */
  scripts: number;
  reruns: { findingId: number; stillReproduces: boolean; run: ReproRun }[];
};

const succeeded = (
  output: unknown,
  sessions: SessionRecord[] = [],
  fixChecks?: FixStatus[],
): StageResult => ({
  status: 'succeeded',
  output,
  sessions,
  findings: [],
  questions: [],
  notChecked: [],
  ...(fixChecks ? { fixChecks } : {}),
});

/** The findings to check and where the fix diff starts (the PR base when nothing was reviewed). */
async function targets(context: StageContext) {
  const { findings, fromSha } = await fixTargetsOfRun(context.deps.db, context.run);
  return { findings, fromSha: fromSha ?? context.pullRequest.baseSha, reviewed: fromSha };
}

export const fixDiffStage: StageExecutor = {
  key: 'fix_diff',
  usesAgent: false,
  async run(context) {
    const { deps, run, repository } = context;
    const { findings, fromSha, reviewed } = await targets(context);
    await fetchMirror(context);
    const diff = await deps.gitMirror.diff(repository.githubFullName, fromSha, run.headSha);
    const output: FixDiffOutput = {
      fromSha: reviewed,
      toSha: run.headSha,
      files: diff.files,
      findings: findings.map(({ id, ordinal, title, file }) => ({
        findingId: id,
        ordinal,
        title,
        file,
      })),
    };
    return succeeded(output);
  },
};

export const checkFixesStage: StageExecutor = {
  key: 'check_fixes',
  usesAgent: true,
  async run(context) {
    const { deps, run, repository, level, signal } = context;
    const { findings, fromSha } = await targets(context);
    const output = (checked: FixStatus[]): CheckFixesOutput => ({
      fromSha,
      toSha: run.headSha,
      checked: checked.length,
      resolved: checked.filter((check) => check.resolved).length,
    });
    if (findings.length === 0) return succeeded(output([]));

    const worktree = await runWorktree(context);
    const diff = await deps.gitMirror.diff(repository.githubFullName, fromSha, run.headSha);
    const model = runModel(run, 'reviewer');
    signal.throwIfAborted();
    const { prompt, ...result } = await checkFixes(deps.agentRunner, {
      model,
      worktree,
      findings: findings.map(fixCheckFinding),
      diff: diff.patch,
      fromSha,
      toSha: run.headSha,
      maxTurns: FIX_CHECK_MAX_TURNS,
      maxCostUsd: FIX_CHECK_MAX_COST_USD,
      stageTimeoutMinutes: level.settings.stageTimeoutMinutes,
      signal,
    });
    const sessions: SessionRecord[] = [{ role: 'reviewer', model, prompt, result }];
    if (result.status !== 'completed' || !result.output) {
      const error = result.error ?? { code: 'agent_failed', params: {} };
      return {
        status: 'failed',
        error: {
          code: error.code === 'output_invalid' ? 'fix_check_output_invalid' : error.code,
          params: error.params,
        },
        sessions,
      };
    }
    return succeeded(output(result.output), sessions, result.output);
  },
};

export const reproductionsStage: StageExecutor = {
  key: 'reproductions',
  usesAgent: false,
  async run(context) {
    const { deps, run, pullRequest } = context;
    const { findings } = await targets(context);
    const scripts = await reproductionScripts(
      deps.db,
      findings.map((finding) => finding.id),
    );
    const runScripts = !pullRequest.isFork;
    const output: ReproductionsOutput = { runScripts, scripts: scripts.size, reruns: [] };
    if (!runScripts || scripts.size === 0) return succeeded(output);

    const worktree = await runWorktree(context);
    const checks = new Map((await fixChecksOfRun(deps.db, run.id)).map((c) => [c.findingId, c]));
    const fixChecks: FixStatus[] = [];
    for (const [findingId, script] of scripts) {
      const result = await reproduce(context, worktree, findingId, script, 1);
      const kept = await keepRun(context, findingId, 1, result, 'reproductions');
      // Exit 0: the bug still shows. That beats a Resolved from the reviewer.
      const stillReproduces = result.exitCode === 0;
      output.reruns.push({ findingId, stillReproduces, run: kept });
      if (stillReproduces && checks.get(findingId)?.resolved !== false) {
        fixChecks.push({ findingId, resolved: false, reason: STILL_REPRODUCES_REASON });
      }
    }
    return succeeded(output, [], fixChecks);
  },
};

export function fixCheckFinding(row: FindingRow): FixCheckFinding {
  const { id, title, file, line, scenario, suggestion } = row;
  return { id, title, file, line, scenario, suggestion };
}
