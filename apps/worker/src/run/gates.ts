// Start gates (P-05 extension point, used by P-16 for pause, budget and agent slots). A gate that
// says wait leaves the run queued (`beforeRoundStart`) or the stage pending (`beforeSession`); the
// job ends without work and whoever opens the gate sends the stage job again.
import type { Reason } from '@pra/core';
import type { PullRequest, Repository, Run } from '@pra/db';
import type { WorkerDeps } from '../deps.ts';
import { queueRoundGate, queueSessionGate } from './budget-gate.ts';

export type GateDecision = { start: true } | { start: false; reason: Reason };

export type GateContext = {
  deps: WorkerDeps;
  run: Run;
  pullRequest: PullRequest;
  repository: Repository;
  /** The stage about to start. */
  stage: string;
};

export type RunGate = (context: GateContext) => Promise<GateDecision>;

export type RunGates = {
  /** Before a queued run starts. */
  beforeRoundStart: RunGate[];
  /** Before a stage that runs an agent session starts. */
  beforeSession: RunGate[];
};

/** Register a gate by adding it to its list. */
export const RUN_GATES: RunGates = {
  // P-16 handoff: register queueRoundGate / queueSessionGate here together with the drainer and
  // NO_RUN_GATES as the test-deps default (see context/changes/P-16-handoff.md).
  beforeRoundStart: [],
  beforeSession: [],
};
void queueRoundGate;
void queueSessionGate;

/** No gates: for tests whose shared database holds other tests' runs (they would fill slots). */
export const NO_RUN_GATES: RunGates = { beforeRoundStart: [], beforeSession: [] };

/** The first gate that says wait, or start. */
export async function passGates(gates: RunGate[], context: GateContext): Promise<GateDecision> {
  for (const gate of gates) {
    const decision = await gate(context);
    if (!decision.start) return decision;
  }
  return { start: true };
}
