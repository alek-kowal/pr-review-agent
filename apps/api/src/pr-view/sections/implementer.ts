// S-13-T4: Implement with agent on the PR page. Whether the PR allows it (the decision form's
// checkbox), whether it may start now (the banner's Dialog), the running implementer (Fixing and
// its Cancel) and the latest patch (the Patch tab's summary line).
import { canImplementWithAgent, implementBlock } from '@pra/core';
import { ACTIVE_RUN_STATUSES, implementerRequest, latestPatch, runsOfPullRequest } from '@pra/db';
import { z } from 'zod/v4';
import { PatchSummarySchema, patchSummary } from '../patch.ts';
import { ReasonSchema } from '../round.ts';
import { defineSection } from '../section.ts';
import { prStateOf } from '../state.ts';

const isActive = (status: string) => (ACTIVE_RUN_STATUSES as readonly string[]).includes(status);

export const ImplementerSchema = z.object({
  /** Why the PR itself refuses the implementer (a fork, a level below 4), or null. */
  block: ReasonSchema.nullable(),
  /** Whether Implement with agent may start now, on which findings, and why not. */
  gate: z.object({
    allowed: z.boolean(),
    reason: ReasonSchema.nullable(),
    findingIds: z.array(z.number().int()),
  }),
  /** The queued or running implementer run: Fixing shows it with Cancel. */
  activeRun: z
    .object({
      id: z.number().int(),
      status: z.enum(ACTIVE_RUN_STATUSES),
      findingIds: z.array(z.number().int()),
      /** A revise run: the revision it starts from. */
      revisesPatchId: z.number().int().nullable(),
    })
    .nullable(),
  /** The newest patch revision, whatever its status. */
  patch: PatchSummarySchema.nullable(),
});

export const implementerSection = defineSection({
  key: 'implementer',
  schema: ImplementerSchema,
  async build(context) {
    const { db, pullRequest } = context;
    const [{ input }, runs, patch] = await Promise.all([
      prStateOf(context),
      runsOfPullRequest(db, pullRequest.id),
      latestPatch(db, pullRequest.id),
    ]);
    const gate = canImplementWithAgent(input, input.findings);
    const active = runs.findLast((run) => run.kind === 'implementer' && isActive(run.status));
    const request = active ? await implementerRequest(db, active.id) : undefined;
    return {
      block: implementBlock(input),
      gate: gate.allowed
        ? { allowed: true, reason: null, findingIds: gate.findingIds.map(Number) }
        : { allowed: false, reason: gate.reason, findingIds: [] },
      activeRun: active
        ? {
            id: active.id,
            status: active.status as (typeof ACTIVE_RUN_STATUSES)[number],
            findingIds: request?.findingIds ?? [],
            revisesPatchId: request?.revisesPatchId ?? null,
          }
        : null,
      patch: patch ? patchSummary(patch) : null,
    };
  },
});
