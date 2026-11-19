// A change type forced by a person on a PR (FR-030); the Change type stage reads it.
import type { ChangeType } from '@pra/core';
import { eq } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { pullRequests } from '../schema/repositories.ts';

/** Sets (or, with null, clears) the change type a person forced on the PR. */
export async function setForcedChangeType(
  db: Executor,
  pullRequestId: number,
  changeType: ChangeType | null,
): Promise<void> {
  await db
    .update(pullRequests)
    .set({ forcedChangeType: changeType })
    .where(eq(pullRequests.id, pullRequestId));
}
