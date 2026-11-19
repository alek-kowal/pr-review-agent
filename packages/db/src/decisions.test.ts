import { afterAll, describe, expect, test } from 'vitest';
import {
  closeDb,
  createDb,
  currentDecisions,
  decideFindings,
  insertFindings,
  insertRun,
  isUniqueViolation,
  listDecisionBatches,
  listTeamMembers,
  removeTeamMember,
  undoDecisionBatch,
} from './index.ts';
import {
  aFinding,
  aRun,
  seedPullRequest,
  seedTeamMember,
  testDatabaseUrl,
  uniqueId,
} from './testing/index.ts';

// Two connections at least, so the concurrent calls really run side by side.
const db = createDb(testDatabaseUrl(), { max: 4 });
afterAll(() => closeDb(db));

async function seedFindings(count: number) {
  const { pullRequest } = await seedPullRequest(db);
  const run = await insertRun(db, aRun(pullRequest.id, { status: 'completed' }));
  const rows = await insertFindings(
    db,
    Array.from({ length: count }, (_, i) => aFinding(run.id, pullRequest.id, i + 1)),
  );
  return { pullRequestId: pullRequest.id, findings: rows };
}

const versionsOf = (rows: { id: number; version: number }[]) =>
  Object.fromEntries(rows.map((row) => [row.id, row.version]));

describe('decideFindings', () => {
  test('decides several findings in one batch and bumps their versions', async () => {
    const { pullRequestId, findings } = await seedFindings(2);
    const tomek = await seedTeamMember(db, { name: 'Tomek' });

    const result = await decideFindings(db, {
      pullRequestId,
      findingIds: findings.map((f) => f.id),
      expectedVersions: versionsOf(findings),
      decision: 'implement',
      signedBy: tomek.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.versions).toEqual({ [findings[0]!.id]: 1, [findings[1]!.id]: 1 });
    const current = await currentDecisions(
      db,
      findings.map((f) => f.id),
    );
    expect([...current.values()].map((d) => [d.decision, d.signerName, d.batchId])).toEqual([
      ['implement', 'Tomek', result.batch.id],
      ['implement', 'Tomek', result.batch.id],
    ]);
    expect(await listDecisionBatches(db, pullRequestId)).toEqual([
      expect.objectContaining({
        id: result.batch.id,
        findingIds: findings.map((f) => f.id),
        undoneAt: null,
      }),
    ]);
  });

  test('two concurrent calls with the same expected version leave exactly one applied', async () => {
    const { pullRequestId, findings } = await seedFindings(2);
    const [kasia, piotr] = [
      await seedTeamMember(db, { name: 'Kasia' }),
      await seedTeamMember(db, { name: 'Piotr' }),
    ];
    const seen = versionsOf(findings);
    const findingIds = findings.map((f) => f.id);

    const results = await Promise.all([
      decideFindings(db, {
        pullRequestId,
        findingIds,
        expectedVersions: seen,
        decision: 'implement',
        signedBy: kasia.id,
      }),
      decideFindings(db, {
        pullRequestId,
        findingIds: [...findingIds].reverse(),
        expectedVersions: seen,
        decision: 'reject',
        reason: 'validated earlier in the parser',
        signedBy: piotr.id,
      }),
    ]);

    const applied = results.filter((r) => r.ok);
    const refused = results.filter((r) => !r.ok);
    expect(applied).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const winner = applied[0]!;
    const loser = refused[0]!;
    if (!winner.ok || loser.ok || loser.reason !== 'conflict') throw new Error('unexpected');

    const winnerName = winner.batch.signedBy === kasia.id ? 'Kasia' : 'Piotr';
    expect(loser.conflicts).toHaveLength(2);
    for (const conflict of loser.conflicts) {
      expect(conflict).toMatchObject({ expectedVersion: 0, version: 1 });
      expect(conflict.current).toMatchObject({
        batchId: winner.batch.id,
        decision: winner.batch.decision,
        signerName: winnerName,
      });
    }
    expect(await listDecisionBatches(db, pullRequestId)).toHaveLength(1);
  });

  test('writes nothing when one finding of the batch moved', async () => {
    const { pullRequestId, findings } = await seedFindings(2);
    const tomek = await seedTeamMember(db, { name: 'Tomek' });
    const [first, second] = findings as [(typeof findings)[0], (typeof findings)[0]];
    await decideFindings(db, {
      pullRequestId,
      findingIds: [first.id],
      expectedVersions: { [first.id]: 0 },
      decision: 'defer',
      signedBy: tomek.id,
    });

    const result = await decideFindings(db, {
      pullRequestId,
      findingIds: [first.id, second.id],
      expectedVersions: { [first.id]: 0, [second.id]: 0 },
      decision: 'implement',
      signedBy: tomek.id,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: 'conflict',
      conflicts: [{ findingId: first.id, version: 1, current: { decision: 'defer' } }],
    });
    expect((await currentDecisions(db, [second.id])).size).toBe(0);
  });

  test('refuses findings of another PR', async () => {
    const { findings } = await seedFindings(1);
    const other = await seedFindings(1);
    const tomek = await seedTeamMember(db);

    const result = await decideFindings(db, {
      pullRequestId: other.pullRequestId,
      findingIds: [findings[0]!.id],
      expectedVersions: versionsOf(findings),
      decision: 'implement',
      signedBy: tomek.id,
    });

    expect(result).toEqual({ ok: false, reason: 'not_found', missing: [findings[0]!.id] });
  });

  test('a removed member keeps their name on past decisions', async () => {
    const { pullRequestId, findings } = await seedFindings(1);
    const ola = await seedTeamMember(db, { name: 'Ola' });
    await decideFindings(db, {
      pullRequestId,
      findingIds: [findings[0]!.id],
      expectedVersions: versionsOf(findings),
      decision: 'implement',
      signedBy: ola.id,
    });

    await removeTeamMember(db, ola.id);

    expect((await currentDecisions(db, [findings[0]!.id])).get(findings[0]!.id)).toMatchObject({
      signerName: 'Ola',
    });
    expect((await listTeamMembers(db)).map((m) => m.id)).not.toContain(ola.id);
  });
});

describe('undoDecisionBatch', () => {
  test('restores the previous decision', async () => {
    const { pullRequestId, findings } = await seedFindings(1);
    const finding = findings[0]!;
    const [kasia, tomek] = [
      await seedTeamMember(db, { name: 'Kasia' }),
      await seedTeamMember(db, { name: 'Tomek' }),
    ];
    const first = await decideFindings(db, {
      pullRequestId,
      findingIds: [finding.id],
      expectedVersions: { [finding.id]: 0 },
      decision: 'implement',
      signedBy: kasia.id,
    });
    if (!first.ok) throw new Error('first decision failed');
    const second = await decideFindings(db, {
      pullRequestId,
      findingIds: [finding.id],
      expectedVersions: first.versions,
      decision: 'reject',
      reason: 'out of scope',
      signedBy: tomek.id,
    });
    if (!second.ok) throw new Error('second decision failed');

    const undone = await undoDecisionBatch(db, second.batch.id);

    expect(undone).toMatchObject({ ok: true, versions: { [finding.id]: 3 } });
    expect((await currentDecisions(db, [finding.id])).get(finding.id)).toMatchObject({
      batchId: first.batch.id,
      decision: 'implement',
      signerName: 'Kasia',
    });
    expect(await undoDecisionBatch(db, second.batch.id)).toEqual({
      ok: false,
      reason: 'already_undone',
    });
  });

  test('undoing the only decision leaves the finding undecided', async () => {
    const { pullRequestId, findings } = await seedFindings(1);
    const tomek = await seedTeamMember(db);
    const result = await decideFindings(db, {
      pullRequestId,
      findingIds: [findings[0]!.id],
      expectedVersions: versionsOf(findings),
      decision: 'defer',
      signedBy: tomek.id,
    });
    if (!result.ok) throw new Error('decision failed');

    expect((await undoDecisionBatch(db, result.batch.id)).ok).toBe(true);
    expect((await currentDecisions(db, [findings[0]!.id])).size).toBe(0);
  });

  test('refuses when a finding of the batch changed since', async () => {
    const { pullRequestId, findings } = await seedFindings(1);
    const finding = findings[0]!;
    const tomek = await seedTeamMember(db);
    const first = await decideFindings(db, {
      pullRequestId,
      findingIds: [finding.id],
      expectedVersions: { [finding.id]: 0 },
      decision: 'implement',
      signedBy: tomek.id,
    });
    if (!first.ok) throw new Error('first decision failed');
    await decideFindings(db, {
      pullRequestId,
      findingIds: [finding.id],
      expectedVersions: first.versions,
      decision: 'defer',
      signedBy: tomek.id,
    });

    expect(await undoDecisionBatch(db, first.batch.id)).toEqual({
      ok: false,
      reason: 'changed_since',
      findingIds: [finding.id],
    });
    expect(await undoDecisionBatch(db, 2_000_000_000)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('team members', () => {
  test('a GitHub login is unique among active members, case-insensitively', async () => {
    const login = `Kasia-${uniqueId()}`;
    const kasia = await seedTeamMember(db, { githubLogin: login });

    const duplicate = seedTeamMember(db, { githubLogin: login.toLowerCase() });
    await expect(duplicate).rejects.toSatisfy((error) =>
      isUniqueViolation(error, 'team_members_github_login_active'),
    );

    await removeTeamMember(db, kasia.id);
    await expect(seedTeamMember(db, { githubLogin: login })).resolves.toMatchObject({
      githubLogin: login,
    });
  });
});
