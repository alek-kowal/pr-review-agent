// The Verify stage (S-05-T2), last in a round from level 3: a verifier session per finding of this
// run, quotes checked word for word against the worktree at the reviewed SHA, the reproduction
// run in the sandbox (no network, worktree read-only) with one repair, and core rules for the
// verdict. The stage writes verdicts itself, under the run's lock, before it returns.
import {
  repairReproduction,
  verifyFinding,
  type AgentRunner,
  type VerifierOutput,
} from '@pra/agents';
import {
  applyReproduction,
  checkQuotes,
  limitsFor,
  runModel,
  reproRepairAllowed,
  skipVerification,
  type Evidence,
  type Reason,
  type Verdict,
  type VerifierCheck,
} from '@pra/core';
import {
  activeInstructions,
  findingsOfRun,
  saveVerifications,
  type FindingRow,
  type VerificationWrite,
} from '@pra/db';
import { DEFAULT_SANDBOX_IMAGE, type SandboxLimits, type SandboxResult } from '@pra/integrations';
import { randomUUID } from 'node:crypto';
import { constants, readFileSync, realpathSync } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { changeTypeOfRun } from './change-type.ts';
import { effectiveInstructions } from './review/prompt.ts';
import type {
  SessionRecord,
  StageContext,
  StageError,
  StageExecutor,
  StageResult,
} from './stage.ts';
import { taskOfRun, taskText } from './task.ts';
import { runWorktree } from './worktree.ts';

export const VERIFIER_PROMPT_FILE = 'prompt-verifier.md';
export const VERIFIER_RULES_FILE = 'verify-rules.md';
/** Per verifier session (one finding, or its repair). */
export const VERIFY_MAX_TURNS = 60;
export const VERIFY_MAX_COST_USD = 3;
/** A reproduction: no network, read-only worktree, 5 minutes. */
export const REPRO_LIMITS: SandboxLimits = {
  cpus: 2,
  memoryMb: 2048,
  pids: 512,
  timeoutMs: 5 * 60_000,
};
const WORKDIR = '/work';
const REPRO_ENV: Readonly<Record<string, string>> = {
  HOME: '/tmp',
  PATH: '/usr/local/bin:/usr/bin:/bin',
};

/** One sandbox run of a reproduction, as kept in the stage output. */
export type ReproRun = {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
  outputBlobKey: string;
};

/** One finding's result in the stage output. */
export type VerifyFindingResult = {
  findingId: number;
  ordinal: number;
  verdict: Verdict;
  reason: Reason;
  verifierVerdict: Verdict | null;
  quotes: { kept: number; dropped: number };
  runs: ReproRun[];
  repaired: boolean;
};

export type VerifyOutput = {
  changeType: string | null;
  /** False for a fork PR: its code is read, never run. */
  runScripts: boolean;
  verified: number;
  skipped: number;
  /** False when the run stopped running before the verdicts could be written. */
  written: boolean;
  findings: VerifyFindingResult[];
};

export const verifyStage: StageExecutor = {
  key: 'verify',
  usesAgent: true,
  run: runVerify,
};

async function runVerify(context: StageContext): Promise<StageResult> {
  const { deps, run, pullRequest, repository, level, signal } = context;

  const instructions = effectiveInstructions(await activeInstructions(deps.db, repository.id));
  const prompt = instructions.get(VERIFIER_PROMPT_FILE)?.trim();
  const rules = instructions.get(VERIFIER_RULES_FILE)?.trim();
  if (!prompt || !rules) {
    const missing = [VERIFIER_PROMPT_FILE, VERIFIER_RULES_FILE].filter(
      (key) => !instructions.get(key)?.trim(),
    );
    return {
      status: 'failed',
      error: { code: 'verifier_instructions_missing', params: { missing } },
      sessions: [],
    };
  }

  const changeType = (await changeTypeOfRun(deps.db, run.id))?.changeType ?? null;
  const skip = skipVerification(changeType, limitsFor(level.settings, changeType));
  const worktree = await runWorktree(context);
  const diff = await deps.gitMirror.diff(
    repository.githubFullName,
    pullRequest.baseSha,
    run.headSha,
  );
  const model = runModel(run, 'verifier');
  const runScripts = !pullRequest.isFork;
  const base = {
    model,
    worktree,
    diff: diff.patch,
    task: taskText(await taskOfRun(deps.db, run.id)),
    instructions: { prompt, rules },
    runScripts,
    maxTurns: VERIFY_MAX_TURNS,
    maxCostUsd: VERIFY_MAX_COST_USD,
    stageTimeoutMinutes: level.settings.stageTimeoutMinutes,
    signal,
  };
  const readFile = worktreeReader(worktree);

  const sessions: SessionRecord[] = [];
  const writes: VerificationWrite[] = [];
  const results: VerifyFindingResult[] = [];
  let skipped = 0;

  for (const finding of await findingsOfRun(deps.db, run.id)) {
    const decision = skip(finding);
    if (decision.skip) {
      skipped += 1;
      writes.push({
        findingId: finding.id,
        verdict: 'unchecked',
        reason: decision.reason,
        evidence: [],
      });
      results.push({
        findingId: finding.id,
        ordinal: finding.ordinal,
        verdict: 'unchecked',
        reason: decision.reason,
        verifierVerdict: null,
        quotes: { kept: 0, dropped: 0 },
        runs: [],
        repaired: false,
      });
      continue;
    }

    const input = { ...base, finding: claimOf(finding) };
    const session = async (
      repair: { script: string; output: string } | null,
    ): Promise<{ output: VerifierOutput } | { error: StageError }> => {
      let prompt = '';
      const runner: AgentRunner = {
        run: (agentInput) => {
          prompt = agentInput.prompt;
          return deps.agentRunner.run(agentInput);
        },
      };
      const result = repair
        ? await repairReproduction(runner, { ...input, ...repair })
        : await verifyFinding(runner, input);
      sessions.push({ role: 'verifier', model, prompt, result });
      if (result.status === 'completed' && result.output) return { output: result.output };
      const error = result.error ?? { code: 'agent_failed', params: {} };
      return {
        error: {
          code: error.code === 'output_invalid' ? 'verifier_output_invalid' : error.code,
          params: { ...error.params, findingId: finding.id },
        },
      };
    };

    let answer = await session(null);
    if ('error' in answer) return { status: 'failed', error: answer.error, sessions };

    // A script that breaks (exit other than 0 or 3, or the time limit) gets one repair.
    const runs: ReproRun[] = [];
    let script: string | null = null;
    let last: SandboxResult | null = null;
    while (runScripts && answer.output.reproduction) {
      script = answer.output.reproduction;
      last = await reproduce(context, worktree, finding.id, script, runs.length + 1);
      runs.push(await keepRun(context, finding.id, runs.length + 1, last));
      if (last.exitCode === 0 || last.exitCode === 3) break;
      if (!reproRepairAllowed(runs.length - 1).ok) break;
      answer = await session({ script, output: last.output });
      if ('error' in answer) return { status: 'failed', error: answer.error, sessions };
    }
    const repaired = runs.length > 1;

    const { evidence } = answer.output;
    const { kept, dropped } = splitQuotes(evidence, readFile);
    const check: VerifierCheck = {
      findingId: String(finding.id),
      verdict: answer.output.verdict,
      evidence: kept.length ? kept : evidence,
    };
    // The script's result beats the verifier's verdict; without one, the quotes decide (none
    // left, or none given: Not proven).
    const final = last
      ? applyReproduction(check, last.exitCode ?? -1)
      : checkQuotes(check, readFile);

    writes.push({
      findingId: finding.id,
      verdict: final.verdict,
      reason: final.reason,
      evidence: kept,
      verifierVerdict: answer.output.verdict,
      verifierReason: answer.output.reason,
      droppedQuotes: dropped,
      remedy: answer.output.remedy,
      script: last ? script : null,
      exitCode: last?.exitCode ?? null,
      timedOut: last?.timedOut ?? false,
      outputTail: last?.outputTail ?? null,
      outputBlobKey: runs.at(-1)?.outputBlobKey ?? null,
      repaired,
      sandboxRuns: runs.length,
    });
    results.push({
      findingId: finding.id,
      ordinal: finding.ordinal,
      verdict: final.verdict,
      reason: final.reason,
      verifierVerdict: answer.output.verdict,
      quotes: { kept: kept.length, dropped: dropped.length },
      runs,
      repaired,
    });
  }

  const written = await saveVerifications(deps.db, run.id, writes);
  const output: VerifyOutput = {
    changeType,
    runScripts,
    verified: results.length - skipped,
    skipped,
    written,
    findings: results,
  };
  return { status: 'succeeded', output, sessions, findings: [], questions: [], notChecked: [] };
}

/** The claim only: never the reviewer's suggestion (core `verifierInput` shape). */
function claimOf(finding: FindingRow) {
  const { severity, title, file, line, scenario } = finding;
  return { id: String(finding.id), severity, title, file, line, scenario };
}

/** Quotes found word for word (core quote check, one at a time) and the ones that are not. */
function splitQuotes(
  evidence: readonly Evidence[],
  readFile: (file: string) => string | null,
): { kept: Evidence[]; dropped: Evidence[] } {
  const kept: Evidence[] = [];
  const dropped: Evidence[] = [];
  for (const quote of evidence) {
    const found = checkQuotes({ findingId: '', verdict: 'confirmed', evidence: [quote] }, readFile);
    (found.verdict === 'confirmed' ? kept : dropped).push(quote);
  }
  return { kept, dropped };
}

/** Reads a file of the worktree (the reviewed SHA); null outside it, in `.git`, or missing. */
function worktreeReader(worktree: string): (file: string) => string | null {
  const root = realpathSync(worktree);
  const inside = (full: string) => {
    const relative = path.relative(root, full);
    return (
      relative !== '' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      relative.split(path.sep)[0] !== '.git'
    );
  };
  return (file) => {
    try {
      // A symlink in the PR must not lead out of the worktree.
      const full = realpathSync(path.resolve(root, file));
      return inside(full) ? readFileSync(full, 'utf8') : null;
    } catch {
      return null;
    }
  };
}

/**
 * Runs the script with `node` from the repository root, as the v1 rules say. It sits in the
 * worktree's root for the run, so relative imports resolve, and the worktree is mounted read-only.
 */
export async function reproduce(
  { deps, signal }: Pick<StageContext, 'deps' | 'signal'>,
  worktree: string,
  findingId: number,
  script: string,
  n: number,
): Promise<SandboxResult> {
  // The PR controls the worktree: a fresh random name, created exclusively and never through a
  // symlink, so the write cannot land outside it.
  const name = `.pra-repro-${findingId}-${n}-${randomUUID()}.mjs`;
  const file = path.join(worktree, name);
  const handle = await open(
    file,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    await handle.writeFile(script);
  } finally {
    await handle.close();
  }
  try {
    return await deps.sandbox.run({
      image: DEFAULT_SANDBOX_IMAGE,
      command: ['node', `${WORKDIR}/${name}`],
      workdir: WORKDIR,
      mounts: [{ hostPath: worktree, containerPath: WORKDIR }],
      env: { ...REPRO_ENV },
      network: 'none',
      limits: REPRO_LIMITS,
      signal,
    });
  } finally {
    await rm(file, { force: true });
  }
}

/** Keeps the whole output in BlobStore (under the stage's key) and the rest in the stage output. */
export async function keepRun(
  { deps, run, attempt }: Pick<StageContext, 'deps' | 'run' | 'attempt'>,
  findingId: number,
  n: number,
  result: SandboxResult,
  stage = 'verify',
): Promise<ReproRun> {
  const outputBlobKey = `runs/${run.id}/${stage}-${attempt}/finding-${findingId}-repro-${n}.log`;
  await deps.blobStore.put(outputBlobKey, Buffer.from(result.output), {
    contentType: 'text/plain; charset=utf-8',
  });
  const { exitCode, timedOut, durationMs, outputTail } = result;
  return { exitCode, timedOut, durationMs, outputTail, outputBlobKey };
}
