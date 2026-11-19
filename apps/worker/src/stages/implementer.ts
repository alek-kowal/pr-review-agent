// The implementer run (S-13-T3): Worktree checks out the reviewed commit (plus the earlier patch for
// a revise run), Implement runs the implementer session in it and keeps every changed file in
// BlobStore, Reproductions reruns the fixed findings' reproductions on the patched tree. The patch
// row is written when the run completes (`storePatchOnCompleted`), so a cancelled or failed run
// never leaves one.
import {
  runImplementer,
  type AgentRunner,
  type AgentRunResult,
  type ImplementerFinding,
} from '@pra/agents';
import { REPRO_EXIT, runModel, runPolicy, type PatchReproduction } from '@pra/core';
import {
  answersOfPullRequest,
  getPatch,
  implementerFindings,
  implementerRequest,
  reproductionScripts,
  succeededStageOutput,
  type ImplementerFindingRow,
  type ImplementerRequest,
} from '@pra/db';
import type { BlobStore, GitMirror } from '@pra/integrations';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { stageInstructions } from './instructions.ts';
import type { SessionRecord, StageContext, StageExecutor, StageResult } from './stage.ts';
import { keepRun, reproduce } from './verify.ts';
import { runWorktree } from './worktree.ts';

export const IMPLEMENTER_PROMPT_FILE = 'prompt-implementer.md';
export const IMPLEMENTER_RULES_FILE = 'implement-rules.md';
export const IMPLEMENT_MAX_TURNS = 80;
export const IMPLEMENT_MAX_COST_USD = 5;

/** One file of the patch: its content at the base and after the patch (blob keys). */
export type PatchFileOutput = { path: string; baseBlobKey: string | null; blobKey: string | null };

export type ImplementOutput = {
  fixedFindingIds: number[];
  declined: { id: string; reason: string }[];
  summary: string;
  commitMessage: string;
  files: PatchFileOutput[];
};

export type ReproductionsOutput = {
  reproductions: Record<string, PatchReproduction>;
};

const failed = (
  code: string,
  params: Record<string, unknown> = {},
  sessions: SessionRecord[] = [],
) => ({ status: 'failed', error: { code, params }, sessions }) satisfies StageResult;

const succeeded = (output: unknown, sessions: SessionRecord[] = [], notChecked: string[] = []) =>
  ({
    status: 'succeeded',
    output,
    sessions,
    findings: [],
    questions: [],
    notChecked,
  }) satisfies StageResult;

/** Writes files into the worktree; `null` content deletes the file. Paths stay inside it. */
export async function writeFiles(
  worktree: string,
  files: readonly { path: string; content: string | null }[],
): Promise<void> {
  for (const file of files) {
    const full = path.resolve(worktree, file.path);
    const relative = path.relative(worktree, full);
    if (
      relative.startsWith('..') ||
      path.isAbsolute(relative) ||
      relative.split(path.sep)[0] === '.git'
    ) {
      throw new Error(`patch path outside the worktree: ${file.path}`);
    }
    if (file.content === null) {
      await rm(full, { force: true });
    } else {
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, file.content);
    }
  }
}

/** The text of a blob, or null for a missing key. */
async function blobText(blobStore: BlobStore, key: string | null): Promise<string | null> {
  if (!key) return null;
  const blob = await blobStore.get(key);
  return blob ? Buffer.from(blob.body).toString('utf8') : null;
}

/** Applies patch files (as blob keys) on top of the worktree. */
export async function applyPatchFiles(
  blobStore: BlobStore,
  worktree: string,
  files: readonly Pick<PatchFileOutput, 'path' | 'blobKey'>[],
): Promise<void> {
  const contents = [];
  for (const file of files) {
    contents.push({ path: file.path, content: await blobText(blobStore, file.blobKey) });
  }
  await writeFiles(worktree, contents);
}

/** Puts the worktree back at its checked-out commit: earlier edits are undone. */
async function resetWorktree(gitMirror: GitMirror, worktree: string): Promise<void> {
  const changes = await gitMirror.worktreeChanges(worktree);
  await writeFiles(
    worktree,
    changes.map((change) => ({ path: change.path, content: change.base })),
  );
}

async function requestOf(context: StageContext): Promise<ImplementerRequest> {
  const request = await implementerRequest(context.deps.db, context.run.id);
  if (!request) {
    throw Object.assign(new Error('implementer request missing'), {
      code: 'implementer_request_missing',
    });
  }
  return request;
}

/**
 * The run's worktree at the reviewed commit, with nothing else in it but the earlier patch's
 * files for a revise run. Safe to call again after a restart.
 */
async function baseWorktree(context: StageContext, request: ImplementerRequest): Promise<string> {
  const { deps } = context;
  const worktree = await runWorktree(context);
  await resetWorktree(deps.gitMirror, worktree);
  if (request.revisesPatchId) {
    const patch = await getPatch(deps.db, request.revisesPatchId);
    await applyPatchFiles(deps.blobStore, worktree, patch?.files ?? []);
  }
  return worktree;
}

export const implementerWorktreeStage: StageExecutor = {
  key: 'worktree',
  usesAgent: false,
  async run(context) {
    const { deps, pullRequest, repository } = context;
    // Defense in depth next to the gate: a fork stays read-only even when a job was queued
    // directly, so read the fork flag fresh from GitHub.
    const fresh = await deps.github.getPullRequest(repository.githubFullName, pullRequest.number);
    if (!runPolicy({ fork: fresh.isFork || pullRequest.isFork }).implement) {
      return failed('fork_read_only');
    }
    const request = await requestOf(context);
    await baseWorktree(context, request);
    return succeeded({ baseSha: context.run.headSha, revisesPatchId: request.revisesPatchId });
  },
};

function implementerFinding({
  finding,
  verification,
  note,
}: ImplementerFindingRow): ImplementerFinding {
  return {
    id: String(finding.id),
    severity: finding.severity,
    title: finding.title,
    file: finding.file,
    line: finding.line,
    scenario: finding.scenario,
    suggestion: finding.suggestion,
    verifierReason: verification?.verifierReason ?? null,
    remedy: verification?.remedy?.kind ?? null,
    evidence: finding.evidence,
    reproduction: verification?.script ?? null,
    note,
  };
}

/** Reads a changed file of the worktree; a symlink or a missing file reads as deleted. */
async function afterContent(worktree: string, file: string): Promise<string | null> {
  const full = path.join(worktree, file);
  const stat = await lstat(full).catch(() => null);
  if (!stat?.isFile()) return null;
  return readFile(full, 'utf8');
}

export const implementStage: StageExecutor = {
  key: 'implement',
  usesAgent: true,
  async run(context) {
    const { deps, run, pullRequest, level, signal, attempt } = context;
    const request = await requestOf(context);
    const instructions = await stageInstructions(context);
    const prompt = instructions.get(IMPLEMENTER_PROMPT_FILE)?.trim();
    const rules = instructions.get(IMPLEMENTER_RULES_FILE)?.trim();
    if (!prompt || !rules) {
      const missing = [IMPLEMENTER_PROMPT_FILE, IMPLEMENTER_RULES_FILE].filter(
        (key) => !instructions.get(key)?.trim(),
      );
      return failed('implementer_instructions_missing', { missing });
    }
    const worktree = await baseWorktree(context, request);
    const reviseNote = request.revisesPatchId ? request.note : null;
    const findings = (await implementerFindings(deps.db, request.findingIds)).map(
      implementerFinding,
    );
    const answers = (await answersOfPullRequest(deps.db, pullRequest.id)).map((a) => ({
      question: a.question,
      answer: a.answer,
    }));
    const model = runModel(run, 'implementer');

    let sentPrompt = '';
    // The runner's own result object: the live runner knows the session by it, so its cost row
    // is not stored a second time (the adapter returns a mapped copy).
    let raw: AgentRunResult<unknown> | null = null;
    const runner: AgentRunner = {
      run: async (input) => {
        sentPrompt = input.prompt;
        const answer = await deps.agentRunner.run(input);
        raw = answer;
        return answer;
      },
    };
    const result = await runImplementer(runner, {
      model,
      worktree,
      findings,
      answers,
      instructions: { prompt, rules },
      reviseNote,
      maxTurns: IMPLEMENT_MAX_TURNS,
      maxCostUsd: IMPLEMENT_MAX_COST_USD,
      stageTimeoutMinutes: level.settings.stageTimeoutMinutes,
      signal,
    });
    const sessions: SessionRecord[] = [
      { role: 'implementer', model, prompt: sentPrompt, result: raw ?? result },
    ];
    if (result.status !== 'completed' || !result.output) {
      const error = result.error ?? { code: 'agent_failed', params: {} };
      return failed(error.code, error.params, sessions);
    }

    const files: PatchFileOutput[] = [];
    const changes = await deps.gitMirror.worktreeChanges(worktree);
    for (const [index, change] of changes.entries()) {
      const prefix = `runs/${run.id}/implement-${attempt}/file-${index + 1}`;
      const after = await afterContent(worktree, change.path);
      const baseBlobKey = change.base === null ? null : `${prefix}-base.txt`;
      const blobKey = after === null ? null : `${prefix}-after.txt`;
      const contentType = 'text/plain; charset=utf-8';
      if (baseBlobKey) await deps.blobStore.put(baseBlobKey, change.base!, { contentType });
      if (blobKey) await deps.blobStore.put(blobKey, after!, { contentType });
      files.push({ path: change.path, baseBlobKey, blobKey });
    }
    const given = new Set(request.findingIds);
    // A claim with no changed file fixes nothing.
    const fixedFindingIds = files.length
      ? result.output.fixedFindingIds.map(Number).filter((id) => given.has(id))
      : [];
    const output: ImplementOutput = {
      fixedFindingIds,
      declined: result.output.declined,
      summary: result.output.summary,
      commitMessage: result.output.commitMessage,
      files,
    };
    return succeeded(output, sessions, result.output.notChecked);
  },
};

/** The Implement stage's output of this run. */
export async function implementOutput(context: Pick<StageContext, 'deps' | 'run'>) {
  return (await succeededStageOutput(
    context.deps.db,
    context.run.id,
    'implement',
  )) as ImplementOutput | null;
}

/** Exit 3 (the bug no longer shows) passes; any other exit fails. */
export const patchReproduction = (exitCode: number | null): PatchReproduction =>
  exitCode === REPRO_EXIT.notReproduced ? 'pass' : 'fail';

export const implementerReproductionsStage: StageExecutor = {
  key: 'reproductions',
  usesAgent: false,
  async run(context) {
    const { deps, pullRequest } = context;
    const implement = await implementOutput(context);
    if (!implement) return failed('implement_output_missing');
    const reproductions: Record<string, PatchReproduction> = {};
    for (const id of implement.fixedFindingIds) reproductions[String(id)] = 'not_run';
    const scripts = await reproductionScripts(deps.db, implement.fixedFindingIds);
    if (pullRequest.isFork || scripts.size === 0) return succeeded({ reproductions });

    const request = await requestOf(context);
    const worktree = await baseWorktree(context, { ...request, revisesPatchId: null });
    await applyPatchFiles(deps.blobStore, worktree, implement.files);
    const runs = [];
    for (const [findingId, script] of scripts) {
      const result = await reproduce(context, worktree, findingId, script, 1);
      runs.push({ findingId, ...(await keepRun(context, findingId, 1, result, 'reproductions')) });
      reproductions[String(findingId)] = patchReproduction(result.exitCode);
    }
    return succeeded({ reproductions, runs });
  },
};
