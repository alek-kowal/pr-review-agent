// S-19-T1: the source rows of metrics 2 and 5 over one scripted PR life cycle.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  decideFindings,
  getPullRequest,
  headChangesOf,
  insertFindings,
  insertRun,
  recordGithubEvent,
  recordHeadChange,
  recordPrClosed,
  recordPrReady,
  recordStateChange,
  schema,
  stateChangesOf,
  type PullRequest,
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

const sha = (c: string) => c.repeat(40);

async function synchronizeEvent(pr: PullRequest) {
  const { event } = await recordGithubEvent(db, {
    deliveryId: randomUUID(),
    event: 'pull_request',
    action: 'synchronize',
    repositoryFullName: 'acme/metrics',
    prNumber: pr.number,
    blobKey: `github-events/${randomUUID()}.json`,
  });
  return event;
}

async function moveHead(pr: PullRequest, headSha: string) {
  await db
    .update(schema.pullRequests)
    .set({ headSha, commitsCount: pr.commitsCount + 1 })
    .where(eq(schema.pullRequests.id, pr.id));
}

describe('metric logs', () => {
  test('a scripted life cycle logs lane rows in order, one head change and the merge', async () => {
    const { pullRequest: pr } = await seedPullRequest(db, {
      pullRequest: { headSha: sha('a'), baseSha: sha('b'), commitsCount: 1 },
    });
    const kasia = await seedTeamMember(db, { name: 'Kasia' });

    // Ready: the first time counts, a second ready event changes nothing.
    const readyAt = new Date('2026-11-02T09:00:00Z');
    await recordPrReady(db, pr.id, readyAt);
    await recordPrReady(db, pr.id, new Date('2026-11-03T09:00:00Z'));

    // Round 1: queued, running, then one Blocking finding.
    const run = await insertRun(db, aRun(pr.id, { headSha: sha('a'), status: 'queued' }));
    await recordStateChange(db, pr.id, { code: 'pr_ready' });
    await db.update(schema.runs).set({ status: 'running' }).where(eq(schema.runs.id, run.id));
    await recordStateChange(db, pr.id, { code: 'run_started' });
    const [finding] = await insertFindings(db, [
      aFinding(run.id, pr.id, 1, { severity: 'blocking' }),
    ]);
    await db
      .update(schema.runs)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(schema.runs.id, run.id));
    await recordStateChange(db, pr.id, { code: 'run_finished' });

    // Decided: rejected, so nothing is left to fix and the PR is ready to merge.
    const decided = await decideFindings(db, {
      pullRequestId: pr.id,
      findingIds: [finding!.id],
      expectedVersions: { [finding!.id]: finding!.version },
      decision: 'reject',
      reason: 'Not a real problem here.',
      signedBy: kasia.id,
    });
    expect(decided.ok).toBe(true);

    // A person's commit after Ready to merge.
    await moveHead(pr, sha('c'));
    const pushed = await recordHeadChange(db, {
      pullRequestId: pr.id,
      githubEventId: (await synchronizeEvent(pr)).id,
      beforeSha: sha('a'),
      afterSha: sha('c'),
      pusher: 'kasia',
      byBot: false,
      baseSha: sha('b'),
      commit: { parents: [sha('a')], message: 'Rename the label helper' },
      at: new Date(),
    });
    await recordStateChange(db, pr.id, { code: 'pr_pushed' });

    // Merged.
    const mergedAt = new Date('2026-11-04T15:00:00Z');
    await db
      .update(schema.pullRequests)
      .set({ state: 'merged' })
      .where(eq(schema.pullRequests.id, pr.id));
    await recordPrClosed(db, pr.id, { at: mergedAt, merged: { at: mergedAt, sha: sha('d') } });
    await recordStateChange(db, pr.id, { code: 'pr_merged' });

    const states = await stateChangesOf(db, pr.id);
    expect(states.map((s) => [s.state, s.lane, s.reason.code])).toEqual([
      ['queued', 'agents_working', 'pr_ready'],
      ['round_running', 'agents_working', 'run_started'],
      ['findings_to_decide', 'action_needed', 'run_finished'],
      ['ready_to_merge', 'ready_to_merge', 'findings_decided'],
      ['new_commits', 'action_needed', 'pr_pushed'],
      ['merged', null, 'pr_merged'],
    ]);
    expect(states.map((s) => s.headSha)).toEqual([
      sha('a'),
      sha('a'),
      sha('a'),
      sha('a'),
      sha('c'),
      sha('c'),
    ]);

    expect(await headChangesOf(db, pr.id)).toEqual([
      expect.objectContaining({
        id: pushed!.id,
        beforeSha: sha('a'),
        afterSha: sha('c'),
        pusher: 'kasia',
        byBot: false,
        isBaseMerge: false,
      }),
    ]);

    expect(await getPullRequest(db, pr.repositoryId, pr.number)).toMatchObject({
      readyAt,
      closedAt: mergedAt,
      mergedAt,
      mergeSha: sha('d'),
    });
  });

  test('an "Update branch" merge commit is marked as a base merge', async () => {
    const { pullRequest: pr } = await seedPullRequest(db, {
      pullRequest: { headSha: sha('a'), baseSha: sha('b') },
    });
    const update = await recordHeadChange(db, {
      pullRequestId: pr.id,
      githubEventId: null,
      beforeSha: sha('a'),
      afterSha: sha('e'),
      pusher: 'kasia',
      byBot: false,
      baseSha: sha('b'),
      commit: { parents: [sha('a'), sha('b')], message: "Merge branch 'main' into edge-labels" },
      at: new Date(),
    });
    expect(update).toMatchObject({ byBot: false, isBaseMerge: true });

    // A merge of another branch than the base, by hand, is a person's change.
    const other = await recordHeadChange(db, {
      pullRequestId: pr.id,
      githubEventId: null,
      beforeSha: sha('e'),
      afterSha: sha('f'),
      pusher: 'kasia',
      byBot: false,
      baseSha: sha('b'),
      commit: { parents: [sha('e'), sha('9')], message: 'Combine the label work' },
      at: new Date(),
    });
    expect(other?.isBaseMerge).toBe(false);
  });

  test('the same event writes its head change once', async () => {
    const { pullRequest: pr } = await seedPullRequest(db);
    const event = await synchronizeEvent(pr);
    const change = {
      pullRequestId: pr.id,
      githubEventId: event.id,
      beforeSha: sha('a'),
      afterSha: sha('c'),
      pusher: 'pr-review-agent[bot]',
      byBot: true,
      baseSha: sha('b'),
      commit: null,
      at: new Date(),
    };
    expect(await recordHeadChange(db, change)).not.toBeNull();
    expect(await recordHeadChange(db, change)).toBeNull();
    expect(await headChangesOf(db, pr.id)).toHaveLength(1);
  });
});
