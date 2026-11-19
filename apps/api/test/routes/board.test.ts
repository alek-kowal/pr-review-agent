import {
  closeDb,
  createDb,
  decideFindings,
  insertRun,
  latestRunsByKind,
  loadPrStateInput,
  upsertRepository,
  type Repository,
} from '@pra/db';
import {
  aRepositoryConfig,
  aRun,
  seedTeamMember,
  testDatabaseUrl,
  uniqueId,
} from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { BoardResponse, type Board, type BoardCard } from '../../src/board/board.ts';
import { PrViewSchema } from '../../src/pr-view/index.ts';
import { build } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  app = await build({ db });
});

let repository: Repository;
beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
});

async function getBoard(): Promise<Board> {
  const response = await app.inject({ method: 'GET', url: '/api/board' });
  expect(response.statusCode).toBe(200);
  return BoardResponse.parse(response.json());
}

/** Where the board lists this repository's PR `number`. */
function placesOf(board: Board, number: number): string[] {
  const mine = (card: BoardCard) =>
    card.repository.slug === repository.slug && card.number === number;
  const places: string[] = [];
  for (const [lane, { cards }] of Object.entries(board.lanes)) {
    if (cards.some(mine)) places.push(lane);
  }
  if (board.lanes.not_reviewed.drafts.some(mine)) places.push('drafts');
  if (board.mergedOrClosed.some(mine)) places.push('mergedOrClosed');
  return places;
}

const cardOf = (cards: BoardCard[], number: number) =>
  cards.find((card) => card.repository.slug === repository.slug && card.number === number);

describe('GET /api/board', () => {
  test('a PR with 3 undecided Blocking findings is in Action needed with Decide 3 findings', async () => {
    const pr = await seedPr(db, repository.id);
    await seedRound(db, pr, { findings: blocking(3) });

    const board = await getBoard();
    expect(placesOf(board, pr.number)).toEqual(['action_needed']);
    const card = cardOf(board.lanes.action_needed.cards, pr.number)!;
    expect(card.nextStep.banner).toEqual({
      code: 'state_findings_to_decide',
      params: { count: 3, reviewers: 0 },
    });
    expect(card.nextStep.mainAction).toMatchObject({ action: 'decide', signed: true });
  });

  test('a draft is listed under Not reviewed as a draft', async () => {
    const pr = await seedPr(db, repository.id, { isDraft: true });
    expect(placesOf(await getBoard(), pr.number)).toEqual(['drafts']);
  });

  test('a PR never reviewed is in Not reviewed', async () => {
    const pr = await seedPr(db, repository.id);
    expect(placesOf(await getBoard(), pr.number)).toEqual(['not_reviewed']);
  });

  test('a running round is in Agents working', async () => {
    const pr = await seedPr(db, repository.id);
    await seedRound(db, pr, { run: { status: 'running' } });
    const board = await getBoard();
    expect(placesOf(board, pr.number)).toEqual(['agents_working']);
    expect(cardOf(board.lanes.agents_working.cards, pr.number)!.nextStep.state).toBe(
      'round_running',
    );
  });

  test('with every finding rejected, the PR is Ready to merge', async () => {
    const pr = await seedPr(db, repository.id);
    const { findings } = await seedRound(db, pr, { findings: [...blocking(1), {}] });
    const signer = await seedTeamMember(db);
    const decided = await decideFindings(db, {
      pullRequestId: pr.id,
      findingIds: findings.map((f) => f.id),
      expectedVersions: Object.fromEntries(findings.map((f) => [f.id, f.version])),
      decision: 'reject',
      reason: 'Not a bug',
      signedBy: signer.id,
    });
    expect(decided.ok).toBe(true);
    expect(placesOf(await getBoard(), pr.number)).toEqual(['ready_to_merge']);
  });

  test('a merged PR appears only under Merged or closed, and an old one not at all', async () => {
    const merged = await seedPr(db, repository.id, { state: 'merged' });
    await seedRound(db, merged, { findings: blocking(2) });
    const old = await seedPr(db, repository.id, {
      state: 'closed',
      updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    const board = await getBoard();
    expect(placesOf(board, merged.number)).toEqual(['mergedOrClosed']);
    expect(cardOf(board.mergedOrClosed, merged.number)!.nextStep.lane).toBeNull();
    expect(placesOf(board, old.number)).toEqual([]);
  });

  test('Action needed puts failures first, then the newest first inside each group', async () => {
    const day = (d: number) => new Date(`2026-10-${String(d).padStart(2, '0')}T10:00:00Z`);
    const olderDecide = await seedPr(db, repository.id, { openedAt: day(1) });
    await seedRound(db, olderDecide, { findings: blocking(1) });
    const newerDecide = await seedPr(db, repository.id, { openedAt: day(3) });
    await seedRound(db, newerDecide, { findings: blocking(1) });
    const failed = await seedPr(db, repository.id, { openedAt: day(2) });
    await seedRound(db, failed, {
      run: { status: 'failed' },
      failedAt: { stage: 'review', errorCode: 'agent_timeout' },
    });

    const board = await getBoard();
    const mine = board.lanes.action_needed.cards
      .filter((card) => card.repository.slug === repository.slug)
      .map((card) => card.number);
    const order = [failed.number, newerDecide.number, olderDecide.number];
    expect(mine.filter((n) => order.includes(n))).toEqual(order);
    expect(cardOf(board.lanes.action_needed.cards, failed.number)!.nextStep.banner).toMatchObject({
      code: 'state_stage_failed',
      params: { stage: 'review', errorCode: 'agent_timeout' },
    });
  });

  test('the author is named by their Team member, and lists come most recently opened first', async () => {
    const login = `kasia-${uniqueId()}`;
    const kasia = await seedTeamMember(db, { name: 'Kasia', githubLogin: login });
    const first = await seedPr(db, repository.id, {
      authorLogin: login.toUpperCase(),
      openedAt: new Date('2026-09-01T10:00:00Z'),
    });
    const second = await seedPr(db, repository.id, { openedAt: new Date('2026-09-02T10:00:00Z') });

    const board = await getBoard();
    const cards = board.lanes.not_reviewed.cards.filter(
      (card) => card.repository.slug === repository.slug,
    );
    const numbers = cards.map((card) => card.number);
    expect(numbers.indexOf(second.number)).toBeLessThan(numbers.indexOf(first.number));
    expect(cardOf(cards, first.number)!.author).toEqual({
      login: login.toUpperCase(),
      memberId: kasia.id,
      name: 'Kasia',
    });
    expect(board.repositoryCount).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/prs/:repo/:number gains the Next step and the checklist', () => {
  test('nextStep, checklist and author come from the state table', async () => {
    const pr = await seedPr(db, repository.id);
    await seedRound(db, pr, { findings: blocking(2) });
    const response = await app.inject({
      method: 'GET',
      url: `/api/prs/${repository.slug}/${pr.number}`,
    });
    expect(response.statusCode).toBe(200);
    const view = PrViewSchema.parse(response.json());
    expect(view.nextStep).toMatchObject({
      state: 'findings_to_decide',
      lane: 'action_needed',
      tone: 'action',
      banner: { code: 'state_findings_to_decide', params: { count: 2 } },
      who: { code: 'who_usually_author', params: { author: pr.authorLogin } },
    });
    expect(view.checklist.ok).toBe(false);
    expect(view.checklist.items.find((i) => i.item === 'nothing_undecided')).toMatchObject({
      ok: false,
      reason: { code: 'checklist_findings_undecided', params: { count: 2 } },
    });
    expect(view.author).toEqual({ login: pr.authorLogin, memberId: null, name: null });
  });
});

describe('loadPrStateInput', () => {
  test('counts commits since the review, the chain, and reads rounds only', async () => {
    const pr = await seedPr(db, repository.id, { commitsCount: 5 });
    await seedRound(db, pr, { run: { commitsCountAtStart: 3 } });
    // A trial never changes the PR's state.
    await insertRun(db, aRun(pr.id, { kind: 'trial', roundNo: null, status: 'running' }));

    const load = (await loadPrStateInput(db, pr.id))!;
    expect(load.input).toMatchObject({
      reviewedSha: pr.headSha,
      commitsSinceReview: 2,
      chainRounds: 1,
      activeRun: null,
      failedRound: null,
    });
    expect(await loadPrStateInput(db, -1)).toBeNull();
  });

  test('a queued round is the active run, and the last failed round names its stage', async () => {
    const pr = await seedPr(db, repository.id);
    await seedRound(db, pr, {
      run: { status: 'failed', roundNo: 1 },
      failedAt: { stage: 'review', errorCode: 'agent_failed' },
    });
    expect((await loadPrStateInput(db, pr.id))!.input.failedRound).toEqual({
      stage: 'review',
      errorCode: 'agent_failed',
      roundNumber: 1,
      timeoutMinutes: null,
    });

    await insertRun(db, aRun(pr.id, { status: 'queued' }));
    expect((await loadPrStateInput(db, pr.id))!.input.activeRun).toMatchObject({
      kind: 'round',
      status: 'queued',
      roundKind: 'full',
      queue: { cause: 'slot' },
    });
  });

  test('the newest run of each kind per PR (P runs.test.ts 52)', async () => {
    const pr = await seedPr(db, repository.id);
    const at = (minute: number) => new Date(`2026-11-02T10:${minute}:00Z`);
    await insertRun(db, aRun(pr.id, { status: 'completed', createdAt: at(10) }));
    const newestRound = await insertRun(db, aRun(pr.id, { status: 'failed', createdAt: at(20) }));
    const trial = await insertRun(
      db,
      aRun(pr.id, { kind: 'trial', roundNo: null, status: 'completed', createdAt: at(15) }),
    );
    const latest = await latestRunsByKind(db, pr.id);
    expect(latest.get('round')?.id).toBe(newestRound.id);
    expect(latest.get('trial')?.id).toBe(trial.id);
    expect(latest.has('implementer')).toBe(false);
  });
});
