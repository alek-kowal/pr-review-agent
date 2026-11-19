// S-03-T5: signed decisions and their undo write a timeline entry and the PR's new state.
// (No decision route exists on this branch yet, so the writer is tested here.)
import { afterAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  decideFindings,
  insertFindings,
  insertRun,
  recordStateChange,
  recordTimelineEntry,
  stateChangesOf,
  timelineOf,
  undoDecisionBatch,
} from './index.ts';
import {
  aFinding,
  aRun,
  seedPullRequest,
  seedTeamMember,
  testDatabaseUrl,
} from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 2 });
afterAll(() => closeDb(db));

async function reviewedPr() {
  const { pullRequest } = await seedPullRequest(db);
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));
  const findings = await insertFindings(db, [
    aFinding(run.id, pullRequest.id, 1),
    aFinding(run.id, pullRequest.id, 2),
  ]);
  return { pullRequestId: pullRequest.id, findings };
}

describe('timeline writers', () => {
  test('a signed decision writes an entry with the signer and the state it leaves', async () => {
    const { pullRequestId, findings } = await reviewedPr();
    const ola = await seedTeamMember(db, { name: 'Ola' });
    expect((await recordStateChange(db, pullRequestId, { code: 'test' }))?.state).toBe(
      'findings_to_decide',
    );

    const result = await decideFindings(db, {
      pullRequestId,
      findingIds: findings.map((f) => f.id),
      expectedVersions: Object.fromEntries(findings.map((f) => [f.id, f.version])),
      decision: 'implement',
      reason: 'Both are cheap to fix.',
      signedBy: ola.id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const entries = await timelineOf(db, pullRequestId);
    expect(entries).toEqual([
      expect.objectContaining({
        kind: 'findings_decided',
        actor: 'member',
        memberId: ola.id,
        memberName: 'Ola',
        params: { decision: 'implement', count: 2, reason: 'Both are cheap to fix.' },
        at: result.batch.createdAt,
      }),
    ]);
    const states = await stateChangesOf(db, pullRequestId);
    expect(states.map((s) => [s.state, s.lane, s.reason.code])).toEqual([
      ['findings_to_decide', 'action_needed', 'test'],
      ['waiting_for_fix', 'action_needed', 'findings_decided'],
    ]);

    // Undo: an unsigned entry, and the state goes back.
    expect((await undoDecisionBatch(db, result.batch.id)).ok).toBe(true);
    expect((await timelineOf(db, pullRequestId)).map((e) => [e.kind, e.actor])).toEqual([
      ['findings_decided', 'member'],
      ['decision_undone', 'hand'],
    ]);
    expect((await stateChangesOf(db, pullRequestId)).map((s) => s.state)).toEqual([
      'findings_to_decide',
      'waiting_for_fix',
      'findings_to_decide',
    ]);
  });

  test('a conflicting decision writes nothing', async () => {
    const { pullRequestId, findings } = await reviewedPr();
    const ola = await seedTeamMember(db, { name: 'Ola' });
    const result = await decideFindings(db, {
      pullRequestId,
      findingIds: [findings[0]!.id],
      expectedVersions: { [findings[0]!.id]: 7 },
      decision: 'reject',
      signedBy: ola.id,
    });
    expect(result.ok).toBe(false);
    expect(await timelineOf(db, pullRequestId)).toEqual([]);
    expect(await stateChangesOf(db, pullRequestId)).toEqual([]);
  });

  test('an entry is written once per source key; a state is logged only when it changes', async () => {
    const { pullRequestId } = await reviewedPr();
    const entry = {
      pullRequestId,
      actor: { kind: 'bot' as const },
      kind: 'run_finished',
      sourceKey: 'run:1:ended',
    };
    expect(await recordTimelineEntry(db, entry)).not.toBeNull();
    expect(await recordTimelineEntry(db, { ...entry, kind: 'other' })).toBeNull();
    expect(await timelineOf(db, pullRequestId)).toHaveLength(1);

    expect(await recordStateChange(db, pullRequestId, { code: 'a' })).not.toBeNull();
    expect(await recordStateChange(db, pullRequestId, { code: 'b' })).toBeNull();
    expect(await stateChangesOf(db, pullRequestId)).toHaveLength(1);
  });
});
