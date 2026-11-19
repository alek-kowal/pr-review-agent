// S-13: starting an implementer run. Implement with agent takes every open Implement finding of the
// latest round; a revise run takes the findings of the patch it revises plus a note. Both go
// through `createRun`, so pause, budget, agent slots and Cancel apply unchanged.
import {
  canImplementWithAgent,
  implementBlock,
  planRun,
  reason,
  type Actor,
  type Reason,
} from '@pra/core';
import { eq } from 'drizzle-orm';
import { patches } from '../schema/patches.ts';
import { insertImplementerRequest } from './patches.ts';
import { loadPrStateInput, type PrStateLoad } from './pr-state.ts';
import type { Run } from './runs.ts';
import { createRun, type RunStartDeps, type RunTx } from './start-round.ts';

export type StartImplementerInput = {
  pullRequestId: number;
  startedBy: Actor;
  /** A revise run: the ready patch it starts from and the note it works from. */
  revise?: { patchId: number; note: string };
  /**
   * Runs first in the run's transaction, for example the signed decisions that start it. The gate
   * then reads the PR as they left it; a refusal rolls them back.
   */
  prepare?: (tx: RunTx) => Promise<void>;
};

export type StartImplementerResult =
  { started: true; run: Run; findingIds: number[] } | { started: false; reason: Reason };

class Refused extends Error {
  readonly reason: Reason;
  constructor(refusal: Reason) {
    super(refusal.code);
    this.reason = refusal;
  }
}

/** Why a revise cannot start, or the findings it takes. */
async function reviseGate(
  tx: RunTx,
  load: PrStateLoad,
  patchId: number,
): Promise<{ reason: Reason } | { findingIds: number[] }> {
  const block = implementBlock(load.input);
  if (block) return { reason: block };
  const [patch] = await tx.select().from(patches).where(eq(patches.id, patchId));
  if (patch?.pullRequestId !== load.pullRequest.id || patch.status !== 'ready') {
    return { reason: reason('patch_stale', { revision: patch?.revision ?? 0 }) };
  }
  const active = load.input.activeRun;
  if (active) return { reason: reason('run_active', { kind: active.kind, status: active.status }) };
  return { findingIds: patch.findingIds };
}

export async function startImplementer(
  deps: RunStartDeps,
  input: StartImplementerInput,
): Promise<StartImplementerResult> {
  const before = await loadPrStateInput(deps.db, input.pullRequestId);
  if (!before) {
    return {
      started: false,
      reason: reason('pr_not_found', { pullRequestId: input.pullRequestId }),
    };
  }
  if (before.pullRequest.state !== 'open') return { started: false, reason: reason('pr_closed') };
  // The patch applies to the reviewed commit, so the run's worktree checks it out.
  const baseSha = before.reviewedRound?.headSha;
  if (!baseSha) return { started: false, reason: reason('no_implement_decisions') };

  let findingIds: number[] = [];
  try {
    const created = await createRun(deps, {
      pullRequest: { ...before.pullRequest, headSha: baseSha },
      kind: 'implementer',
      level: before.input.level,
      plan: planRun({ kind: 'implementer', level: before.input.level }),
      trigger: input.revise ? 'revise' : 'manual',
      startedBy: input.startedBy,
      beforeInsert: async (tx) => {
        await input.prepare?.(tx);
        const load = await loadPrStateInput(tx, input.pullRequestId);
        if (!load)
          throw new Refused(reason('pr_not_found', { pullRequestId: input.pullRequestId }));
        if (input.revise) {
          const gate = await reviseGate(tx, load, input.revise.patchId);
          if ('reason' in gate) throw new Refused(gate.reason);
          findingIds = gate.findingIds;
          return;
        }
        const gate = canImplementWithAgent(load.input, load.input.findings);
        if (!gate.allowed) throw new Refused(gate.reason);
        findingIds = gate.findingIds.map(Number);
      },
      inTransaction: async (tx, run) => {
        await insertImplementerRequest(tx, {
          runId: run.id,
          findingIds,
          revisesPatchId: input.revise?.patchId ?? null,
          note: input.revise?.note ?? null,
        });
      },
    });
    if (!created.created) {
      const active = before.input.activeRun;
      return {
        started: false,
        reason: reason('run_active', {
          kind: active?.kind ?? 'round',
          status: active?.status ?? 'running',
        }),
      };
    }
    return { started: true, run: created.run, findingIds };
  } catch (error) {
    if (error instanceof Refused) return { started: false, reason: error.reason };
    throw error;
  }
}
