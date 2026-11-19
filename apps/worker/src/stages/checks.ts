// The Checks stage (S-04-T3), first in a round from level 2: CI counts from GitHub and the PR's
// dependencies installed in the sandbox. A failed install is a result, not a stage failure; an
// unreachable sandbox or a GitHub error fails the stage with a reason code.
import { stepOff, type Reason } from '@pra/core';
import { readRepositoryConfig, runPlanOf } from '@pra/db';
import {
  installDependencies,
  IntegrationError,
  type CiStatus,
  type InstallResult,
  type SandboxResult,
} from '@pra/integrations';
import * as path from 'node:path';
import type { StageContext, StageExecutor, StageResult } from './stage.ts';
import { runWorktree } from './worktree.ts';

export const GITHUB_ERROR = 'github_error';

export type InstallStep = {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  outputTail: string;
};

/** The Checks stage's stored output. */
export type ChecksOutput = {
  ci: CiStatus;
  install: {
    status: InstallResult['status'];
    /** The step whose result decides: the failed fetch, or the install. Null when skipped. */
    failedStep: 'fetch' | 'install' | null;
    fetch: InstallStep | null;
    install: InstallStep | null;
    /** Both steps' whole output in BlobStore; null when skipped. */
    logBlobKey: string | null;
    /** Why the plan turned the install off (`fork_read_only`); absent in older outputs. */
    offReason?: Reason | null;
  };
};

export const checksStage: StageExecutor = {
  key: 'checks',
  usesAgent: false,
  run: runChecks,
};

async function runChecks(context: StageContext): Promise<StageResult> {
  const { deps, run, repository, attempt, signal } = context;

  let ci: CiStatus;
  try {
    ci = await deps.github.getCiStatus(repository.githubFullName, run.headSha);
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    const status = (error as { status?: unknown } | null)?.status;
    return {
      status: 'failed',
      error: { code: GITHUB_ERROR, params: { status: typeof status === 'number' ? status : null } },
      sessions: [],
    };
  }

  // A fork's plan turns the install off (S-16): its code never runs, CI status is still read.
  const installOff = stepOff(runPlanOf(run, context.pullRequest), 'checks', 'install');
  const config = readRepositoryConfig(repository).value;
  const result: InstallResult = installOff
    ? { status: 'skipped', fetch: null, install: null }
    : await installDependencies(deps.sandbox, {
        worktree: await runWorktree(context),
        config,
        cacheDir: path.join(deps.dataDir, 'cache', repository.slug),
        fetchLimits: deps.sandboxProfile.fetch,
        installLimits: deps.sandboxProfile.install,
        sharedStore: deps.sandboxProfile.sharedStore,
        signal,
      });

  let logBlobKey: string | null = null;
  if (result.status !== 'skipped') {
    logBlobKey = `runs/${run.id}/checks-${attempt}/install.log`;
    await deps.blobStore.put(logBlobKey, Buffer.from(installLog(result)), {
      contentType: 'text/plain; charset=utf-8',
    });
  }

  const output: ChecksOutput = {
    ci,
    install: {
      status: result.status,
      failedStep: result.status !== 'failed' ? null : result.install === null ? 'fetch' : 'install',
      fetch: step(result.fetch),
      install: step(result.install),
      logBlobKey,
      offReason: installOff,
    },
  };
  return { status: 'succeeded', output, sessions: [], findings: [], questions: [], notChecked: [] };
}

function step(result: SandboxResult | null): InstallStep | null {
  if (!result) return null;
  const { exitCode, timedOut, durationMs, outputTail } = result;
  return { exitCode, timedOut, durationMs, outputTail };
}

function installLog(result: InstallResult): string {
  const part = (name: string, step: SandboxResult | null) =>
    step
      ? `## ${name} (exit ${step.exitCode ?? 'none'}${step.timedOut ? ', timed out' : ''})\n${step.output}\n`
      : '';
  return part('fetch', result.fetch) + part('install', result.install);
}
