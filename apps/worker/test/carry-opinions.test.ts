// S-08-T7: opinions move along to the matching finding of the next full review (FR-043).
import {
  insertFindings,
  insertRun,
  opinionsOf,
  saveReview,
  schema,
  upsertPullRequest,
  type FindingRow,
  type PullRequest,
  type Repository,
  type Run,
} from '@pra/db';
import { aFinding, aPullRequest, aRun, seedTeamMember } from '@pra/db/testing';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { carryOpinionsOnRunCompleted } from '../src/run/carry-opinions.ts';
import { RUN_HOOKS } from '../src/run/hooks.ts';
import { connectRepository, createTestWorkerDeps, type TestWorkerDeps } from './support.ts';

let deps: TestWorkerDeps;
let repository: Repository;
let pullRequest: PullRequest;
let kasia: { id: string };
let tomek: { id: string };

beforeAll(async () => {
  deps = await createTestWorkerDeps();
  kasia = await seedTeamMember(deps.db, { name: 'Kasia' });
  tomek = await seedTeamMember(deps.db, { name: 'Tomek' });
});
afterAll(() => deps.close());

beforeEach(async () => {
  repository = await connectRepository(deps.db);
  ({ pullRequest } = await upsertPullRequest(deps.db, aPullRequest(repository.id)));
});

const UNDO = {
  title: 'Undo loses the group',
  file: 'src/editor/undo.ts',
  scenario: 'Group two nodes, move the group, press Ctrl+Z: the group is gone.',
};
const LABELS = {
  title: 'Labels overflow the node',
  file: 'src/editor/labels.ts',
  scenario: 'A label longer than the node spills over its neighbours.',
};

/** A completed round on a new chain (or round `roundNo` of `chainId`) with these findings. */
async function completedRound(
  findings: Partial<FindingRow>[],
  options: { roundNo?: number; chainId?: string } = {},
): Promise<{ run: Run; findings: FindingRow[] }> {
  const chainId = options.chainId ?? randomUUID();
  if (!options.chainId) {
    await deps.db.insert(schema.roundChains).values({ id: chainId, pullRequestId: pullRequest.id });
  }
  const run = await insertRun(
    deps.db,
    aRun(pullRequest.id, {
      chainId,
      roundNo: options.roundNo ?? 1,
      status: 'completed',
      finishedAt: new Date(),
    }),
  );
  const rows = await insertFindings(
    deps.db,
    findings.map((f, i) => aFinding(run.id, pullRequest.id, i + 1, f)),
  );
  return { run, findings: rows };
}

const carry = (run: Run) => carryOpinionsOnRunCompleted({ deps, run, pullRequest, repository });

async function opinionsOfFinding(id: number) {
  return (await opinionsOf(deps.db, [id])).get(id) ?? [];
}

describe('carrying opinions to the next round', () => {
  test('is registered on round completed', () => {
    expect(RUN_HOOKS.runCompleted).toContain(carryOpinionsOnRunCompleted);
  });

  test('copies opinions to the matching finding, marked from round 1; originals stay; rerunning adds nothing', async () => {
    const first = await completedRound([UNDO, LABELS]);
    const [undo, labels] = first.findings;
    await saveReview(deps.db, {
      pullRequestId: pullRequest.id,
      signedBy: tomek.id,
      opinions: [
        { findingId: undo!.id, value: 'worth', comment: 'Users hit this daily' },
        { findingId: labels!.id, value: 'worth', comment: null },
      ],
    });
    await saveReview(deps.db, {
      pullRequestId: pullRequest.id,
      signedBy: kasia.id,
      opinions: [{ findingId: undo!.id, value: 'not_worth', comment: null }],
    });
    const originals = await opinionsOf(deps.db, [undo!.id, labels!.id]);

    // The next full review: undo moved down; the labels text now sits in another file.
    const second = await completedRound([
      { ...UNDO, line: 80 },
      { ...LABELS, file: 'src/editor/node-label.ts' },
      { title: 'Snap grid ignored', file: 'src/editor/drag.ts', scenario: 'Dragging skips it.' },
    ]);
    const [undoAgain, labelsElsewhere, fresh] = second.findings;
    await carry(second.run);

    const carried = await opinionsOfFinding(undoAgain!.id);
    expect(carried).toHaveLength(2);
    expect(carried).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signedBy: tomek.id,
          value: 'worth',
          comment: 'Users hit this daily',
          fromRound: 1,
          carriedFromId: originals.get(undo!.id)!.find((o) => o.signedBy === tomek.id)!.id,
        }),
        expect.objectContaining({ signedBy: kasia.id, value: 'not_worth', fromRound: 1 }),
      ]),
    );
    expect(await opinionsOfFinding(labelsElsewhere!.id)).toEqual([]);
    expect(await opinionsOfFinding(fresh!.id)).toEqual([]);
    // The originals are untouched.
    expect(await opinionsOf(deps.db, [undo!.id, labels!.id])).toEqual(originals);

    await carry(second.run);
    expect(await opinionsOfFinding(undoAgain!.id)).toHaveLength(2);
  });

  test("a signer's own opinion on the new finding wins over the carried one", async () => {
    const first = await completedRound([UNDO]);
    await saveReview(deps.db, {
      pullRequestId: pullRequest.id,
      signedBy: tomek.id,
      opinions: [{ findingId: first.findings[0]!.id, value: 'worth', comment: null }],
    });
    const second = await completedRound([UNDO]);
    await saveReview(deps.db, {
      pullRequestId: pullRequest.id,
      signedBy: tomek.id,
      opinions: [{ findingId: second.findings[0]!.id, value: 'not_worth', comment: 'Changed' }],
    });

    await carry(second.run);
    const [own] = await opinionsOfFinding(second.findings[0]!.id);
    expect(own).toMatchObject({ value: 'not_worth', comment: 'Changed', carriedFromId: null });
  });

  test('a fix check (round 2 of a chain) carries nothing', async () => {
    const first = await completedRound([UNDO]);
    await saveReview(deps.db, {
      pullRequestId: pullRequest.id,
      signedBy: tomek.id,
      opinions: [{ findingId: first.findings[0]!.id, value: 'worth', comment: null }],
    });
    const fixCheck = await completedRound([UNDO], {
      roundNo: 2,
      chainId: first.run.chainId!,
    });
    await carry(fixCheck.run);
    expect(await opinionsOfFinding(fixCheck.findings[0]!.id)).toEqual([]);
  });
});
