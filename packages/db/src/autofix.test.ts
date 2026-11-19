import { HAND, reason } from '@pra/core';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  autoPatchesInChain,
  autofixStartOfRun,
  closeDb,
  createDb,
  currentDecisions,
  decideFindings,
  insertFindings,
  insertRun,
  latestAutofixWaiting,
  recordAutofixAttempt,
  recordShadow,
  schema,
  shadowByRepository,
  shadowOfPr,
  storePatchRevision,
  timelineOf,
} from './index.ts';
import { aFinding, aRun, seedPullRequest, testDatabaseUrl } from './testing/index.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

async function seedRound(levelNumber: 3 | 4 | 5 = 5) {
  const seeded = await seedPullRequest(db);
  const [chain] = await db
    .insert(schema.roundChains)
    .values({ pullRequestId: seeded.pullRequest.id })
    .returning();
  const round = await insertRun(
    db,
    aRun(seeded.pullRequest.id, { status: 'completed', chainId: chain!.id, levelNumber }),
  );
  return { ...seeded, chainId: chain!.id, round };
}

async function seedImplementer(pullRequestId: number, revision = 1) {
  const run = await insertRun(
    db,
    aRun(pullRequestId, { kind: 'implementer', roundNo: null, chainId: null, status: 'completed' }),
  );
  const { patch } = await storePatchRevision(db, {
    pullRequestId,
    runId: run.id,
    baseSha: 'a'.repeat(40),
    findingIds: [1, 2],
    fixedFindingIds: [1, 2],
    reproductions: { '1': 'pass', '2': 'pass' },
    summary: `Revision ${revision}`,
    reviseNote: null,
    startedBy: HAND,
    files: [{ path: 'src/a.ts', baseBlobKey: 'base/a', blobKey: 'after/a' }],
  });
  return { run, patch };
}

const met = [reason('autofix_conditions_met', { count: 2 })];

describe('autofix attempts', () => {
  test('counts the automatic patches of a chain; one start per round', async () => {
    const { pullRequest, chainId, round } = await seedRound();
    const first = await seedImplementer(pullRequest.id);
    const started = await recordAutofixAttempt(db, {
      pullRequestId: pullRequest.id,
      chainId,
      roundRunId: round.id,
      implementerRunId: first.run.id,
      point: 'start',
      outcome: 'started',
      reasons: met,
    });
    expect(started).toMatchObject({ point: 'start', outcome: 'started' });
    const again = await recordAutofixAttempt(db, {
      pullRequestId: pullRequest.id,
      chainId,
      roundRunId: round.id,
      point: 'start',
      outcome: 'waiting',
      reasons: [reason('autofix_paused')],
    });
    expect(again).toBeNull();

    expect(await autoPatchesInChain(db, chainId)).toBe(1);
    expect(await autoPatchesInChain(db, chainId, { exceptRunId: first.run.id })).toBe(0);
    expect(await autofixStartOfRun(db, first.run.id)).toMatchObject({ id: started!.id });

    // A second round of the chain starts the second automatic patch.
    const round2 = await insertRun(
      db,
      aRun(pullRequest.id, { status: 'completed', chainId, roundNo: 2, trigger: 'own_fix' }),
    );
    const second = await seedImplementer(pullRequest.id, 2);
    await recordAutofixAttempt(db, {
      pullRequestId: pullRequest.id,
      chainId,
      roundRunId: round2.id,
      implementerRunId: second.run.id,
      point: 'start',
      outcome: 'started',
      reasons: met,
    });
    expect(await autoPatchesInChain(db, chainId)).toBe(2);
    // A waiting start and another chain do not count.
    const other = await seedRound();
    await recordAutofixAttempt(db, {
      pullRequestId: other.pullRequest.id,
      chainId: other.chainId,
      roundRunId: other.round.id,
      point: 'start',
      outcome: 'waiting',
      reasons: [reason('open_questions', { count: 1 })],
    });
    expect(await autoPatchesInChain(db, other.chainId)).toBe(0);
  });

  test('the latest waiting push attempt is the banner reason; a push clears it', async () => {
    const { pullRequest, chainId } = await seedRound();
    const { run, patch } = await seedImplementer(pullRequest.id);
    expect(await latestAutofixWaiting(db, patch.id)).toBeNull();
    const sensitive = reason('patch_touches_sensitive', {
      path: 'CLAUDE.md',
      pattern: 'CLAUDE.md',
    });
    await recordAutofixAttempt(db, {
      pullRequestId: pullRequest.id,
      chainId,
      implementerRunId: run.id,
      patchId: patch.id,
      point: 'push',
      outcome: 'waiting',
      reasons: [sensitive],
    });
    expect((await latestAutofixWaiting(db, patch.id))?.reasons).toEqual([sensitive]);

    await recordAutofixAttempt(db, {
      pullRequestId: pullRequest.id,
      chainId,
      implementerRunId: run.id,
      patchId: patch.id,
      point: 'push',
      outcome: 'pushed',
      reasons: [reason('push_conditions_met')],
      sha: 'b'.repeat(40),
    });
    expect(await latestAutofixWaiting(db, patch.id)).toBeNull();

    // Started and waiting add a bot Timeline entry; pushed adds none (the push job writes it).
    const timeline = await timelineOf(db, pullRequest.id);
    expect(timeline.filter((e) => e.kind.startsWith('autofix_'))).toEqual([
      expect.objectContaining({
        kind: 'autofix_waiting',
        actor: 'bot',
        params: expect.objectContaining({ point: 'push', reason: sensitive, patchId: patch.id }),
      }),
    ]);
  });
});

describe('autofix shadow', () => {
  test('one entry per round start and per patch push, with its Timeline entry', async () => {
    const { pullRequest, repository, round } = await seedRound(3);
    const entry = {
      pullRequestId: pullRequest.id,
      repositoryId: repository.id,
      runId: round.id,
      level: 3,
      point: 'start' as const,
      decision: 'would_start' as const,
      reasons: met,
      fixed: 2,
      total: 2,
    };
    expect(await recordShadow(db, entry)).toMatchObject({ decision: 'would_start' });
    expect(await recordShadow(db, { ...entry, decision: 'would_wait' })).toBeNull();

    const { patch } = await seedImplementer(pullRequest.id);
    await recordShadow(db, {
      ...entry,
      runId: null,
      patchId: patch.id,
      point: 'push',
      decision: 'would_push',
      reasons: [reason('push_conditions_met')],
    });
    expect((await shadowOfPr(db, pullRequest.id)).map((s) => s.decision)).toEqual([
      'would_start',
      'would_push',
    ]);
    const rows = (await timelineOf(db, pullRequest.id)).filter((e) => e.kind === 'autofix_shadow');
    expect(rows.map((e) => [e.actor, e.params.decision])).toEqual([
      ['bot', 'would_start'],
      ['bot', 'would_push'],
    ]);
  });

  test('by repository: the latest entry per PR since a day, at a level or above', async () => {
    const a = await seedRound(3);
    const b = await seedPullRequest(db, { repository: { slug: a.repository.slug } });
    const old = new Date(Date.now() - 20 * 86_400_000);
    const base = { repositoryId: a.repository.id, point: 'start' as const, fixed: 1, total: 2 };
    await recordShadow(db, {
      ...base,
      pullRequestId: a.pullRequest.id,
      runId: a.round.id,
      level: 3,
      decision: 'would_wait',
      reasons: [reason('open_questions', { count: 1 })],
    });
    const later = await insertRun(db, aRun(a.pullRequest.id, { status: 'completed' }));
    await recordShadow(db, {
      ...base,
      pullRequestId: a.pullRequest.id,
      runId: later.id,
      level: 4,
      decision: 'would_start',
      reasons: met,
    });
    const bRound = await insertRun(db, aRun(b.pullRequest.id, { status: 'completed' }));
    await recordShadow(db, {
      ...base,
      pullRequestId: b.pullRequest.id,
      runId: bRound.id,
      level: 3,
      decision: 'would_start',
      reasons: met,
      at: old,
    });
    const since = new Date(Date.now() - 14 * 86_400_000);

    const recent = await shadowByRepository(db, {
      repositoryId: a.repository.id,
      since,
      minLevel: 3,
    });
    expect(recent.map((s) => [s.number, s.decision, s.level])).toEqual([
      [a.pullRequest.number, 'would_start', 4],
    ]);
    const all = await shadowByRepository(db, {
      repositoryId: a.repository.id,
      since: old,
      minLevel: 3,
    });
    expect(all.map((s) => s.pullRequestId).sort()).toEqual(
      [a.pullRequest.id, b.pullRequest.id].sort(),
    );
    expect(
      await shadowByRepository(db, { repositoryId: a.repository.id, since, minLevel: 5 }),
    ).toEqual([]);
  });
});

describe('bot-signed decisions', () => {
  test('the bot signs an Implement batch: actor bot, signer pr-review-agent', async () => {
    const { pullRequest, round } = await seedRound();
    const rows = await insertFindings(db, [
      aFinding(round.id, pullRequest.id, 1),
      aFinding(round.id, pullRequest.id, 2),
    ]);
    const result = await decideFindings(db, {
      pullRequestId: pullRequest.id,
      findingIds: rows.map((r) => r.id),
      expectedVersions: Object.fromEntries(rows.map((r) => [r.id, r.version])),
      decision: 'implement',
      signedBy: null,
    });
    expect(result.ok && result.batch).toMatchObject({ actor: 'bot', signedBy: null });
    const current = await currentDecisions(db, [rows[0]!.id]);
    expect(current.get(rows[0]!.id)).toMatchObject({
      decision: 'implement',
      signedBy: null,
      signerName: 'pr-review-agent',
    });
    const decided = (await timelineOf(db, pullRequest.id)).find(
      (e) => e.kind === 'findings_decided',
    );
    expect(decided?.actor).toBe('bot');

    // A member batch must name its member.
    await expect(
      db.execute(
        sql`insert into decision_batches (pull_request_id, decision, actor) values (${pullRequest.id}, 'implement', 'member')`,
      ),
    ).rejects.toThrow();
  });
});
