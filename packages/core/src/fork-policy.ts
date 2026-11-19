// S-16-T1: a fork PR is read-only. Its runs never execute the PR's own code: no install, no
// reproduction scripts, no implementer, no push, no autofix, and no automatic start. The run plan
// (`planRun({ fork })`) marks the steps that would run PR code as off, so no single stage carries
// the guard; reading CI status stays on.
import './reasons/autofix.ts';
import { reason, type Reason } from './reason.ts';

export interface RunPolicy {
  /** A webhook or the reconcile poll may start a round by itself. */
  autoStart: boolean;
  /** Checks installs dependencies. */
  install: boolean;
  /** Verify and the fix check run reproduction scripts. */
  scripts: boolean;
  implement: boolean;
  push: boolean;
  autofix: boolean;
}

export function runPolicy(pr: { fork: boolean }): RunPolicy {
  const own = !pr.fork;
  return { autoStart: own, install: own, scripts: own, implement: own, push: own, autofix: own };
}

/** Steps inside a stage that execute the PR's code. */
export const PR_CODE_STEPS = ['install', 'reproductions'] as const;
export type PrCodeStep = (typeof PR_CODE_STEPS)[number];

/** Where each step sits: install in Checks, reproductions in Verify. */
export const PR_CODE_STEPS_BY_STAGE: Readonly<Record<string, readonly PrCodeStep[]>> = {
  checks: ['install'],
  verify: ['reproductions'],
};

/** A step the plan turns off inside an otherwise running stage. */
export interface OffStep {
  stage: string;
  step: PrCodeStep;
  reason: Reason;
}

/** The fork's off steps for the stages of a plan. */
export function forkOffSteps(stageKeys: readonly string[]): OffStep[] {
  return stageKeys.flatMap((stage) =>
    (PR_CODE_STEPS_BY_STAGE[stage] ?? []).map((step) => ({
      stage,
      step,
      reason: reason('fork_read_only'),
    })),
  );
}

/** Why the plan turns `step` of `stage` off, or null when it runs. */
export function stepOff(
  run: { offSteps: readonly OffStep[] },
  stage: string,
  step: PrCodeStep,
): Reason | null {
  return run.offSteps.find((off) => off.stage === stage && off.step === step)?.reason ?? null;
}
