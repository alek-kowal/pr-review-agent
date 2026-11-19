// S-17-T3: `GET /api/board` filters. Other test files share the database, so each check reads
// only the cards of this file's repositories, except `person`, whose login is unique here.
import { closeDb, createDb, eq, schema, upsertRepository, type Repository } from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { BoardResponse, type Board, type BoardCard } from '../../src/board/board.ts';
import { build } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  app = await build({ db });
});

const allCards = (board: Board): BoardCard[] => [
  ...Object.values(board.lanes).flatMap((lane) => lane.cards),
  ...board.lanes.not_reviewed.drafts,
  ...board.mergedOrClosed,
];

let repoA: Repository;
let repoB: Repository;
const kasiaLogin = `kasia-${uniqueId()}`;
const pr: Record<string, string> = {};
const key = (repository: Repository, number: number) => `${repository.slug}#${number}`;

beforeAll(async () => {
  repoA = await upsertRepository(db, aRepositoryConfig());
  repoB = await upsertRepository(db, aRepositoryConfig());
  const kasia = await seedTeamMember(db, { name: 'Kasia', githubLogin: kasiaLogin });
  const tomek = await seedTeamMember(db, { name: 'Tomek' });

  const authored = await seedPr(db, repoA.id, { authorLogin: kasiaLogin.toUpperCase() });
  const opinionOnly = await seedPr(db, repoA.id);
  const othersOpinion = await seedPr(db, repoA.id);
  for (const [target, signer] of [
    [opinionOnly, kasia],
    [othersOpinion, tomek],
  ] as const) {
    const { findings } = await seedRound(db, target, { findings: blocking(1) });
    await db.insert(schema.opinions).values({
      findingId: findings[0]!.id,
      pullRequestId: target.id,
      signedBy: signer.id,
      value: 'worth',
      fromRound: 1,
    });
  }
  const levelThree = await seedPr(db, repoA.id);
  await db
    .update(schema.pullRequests)
    .set({ level: 3 })
    .where(eq(schema.pullRequests.id, levelThree.id));
  const fork = await seedPr(db, repoB.id, { isFork: true });
  const draft = await seedPr(db, repoB.id, { isDraft: true });

  Object.assign(pr, {
    authored: key(repoA, authored.number),
    opinionOnly: key(repoA, opinionOnly.number),
    othersOpinion: key(repoA, othersOpinion.number),
    levelThree: key(repoA, levelThree.number),
    fork: key(repoB, fork.number),
    draft: key(repoB, draft.number),
  });
});

async function board(query: string): Promise<BoardCard[]> {
  const response = await app.inject({ method: 'GET', url: `/api/board${query}` });
  expect(response.statusCode).toBe(200);
  return allCards(BoardResponse.parse(response.json()));
}

/** This file's PRs among the cards, as sorted `slug#number` keys. */
async function mine(query: string): Promise<string[]> {
  const slugs = [repoA.slug, repoB.slug];
  return (await board(query))
    .filter((card) => slugs.includes(card.repository.slug))
    .map((card) => key({ slug: card.repository.slug } as Repository, card.number))
    .sort();
}

const sorted = (...names: string[]) => names.map((name) => pr[name]!).sort();

describe('GET /api/board filters', () => {
  test('without filters every PR of both repositories is listed', async () => {
    expect(await mine('')).toEqual(
      sorted('authored', 'opinionOnly', 'othersOpinion', 'levelThree', 'fork', 'draft'),
    );
  });

  test('person returns her authored PRs plus a PR where she only signed an opinion, and no other PRs', async () => {
    const cards = await board(`?person=${kasiaLogin}`);
    expect(cards.map((card) => key(card.repository as Repository, card.number)).sort()).toEqual(
      sorted('authored', 'opinionOnly'),
    );
  });

  test('repo lists only that repository', async () => {
    const cards = await board(`?repo=${repoB.slug}`);
    expect(cards.every((card) => card.repository.slug === repoB.slug)).toBe(true);
    expect(await mine(`?repo=${repoB.slug}`)).toEqual(sorted('fork', 'draft'));
  });

  test('forks=only lists only forks, forks=hide leaves them out', async () => {
    expect((await board('?forks=only')).every((card) => card.isFork)).toBe(true);
    expect(await mine('?forks=only')).toEqual(sorted('fork'));
    expect(await mine('?forks=hide')).not.toContain(pr.fork);
    expect((await board('?forks=hide')).some((card) => card.isFork)).toBe(false);
  });

  test('level lists the PRs whose next round starts at that level', async () => {
    expect((await board('?level=3')).every((card) => card.level.number === 3)).toBe(true);
    expect(await mine('?level=3')).toEqual(sorted('levelThree'));
  });

  test('drafts=hide leaves drafts out', async () => {
    const cards = await board('?drafts=hide');
    expect(cards.some((card) => card.isDraft)).toBe(false);
    expect(await mine('?drafts=hide')).not.toContain(pr.draft);
  });

  test('filters combine', async () => {
    expect(await mine(`?repo=${repoB.slug}&forks=hide`)).toEqual(sorted('draft'));
    expect(await mine(`?repo=${repoB.slug}&forks=hide&drafts=hide`)).toEqual([]);
    expect(await mine(`?person=${kasiaLogin}&repo=${repoA.slug}&level=3`)).toEqual([]);
    expect(await mine(`?person=${kasiaLogin}&repo=${repoB.slug}`)).toEqual([]);
  });

  test.each([
    'forks=maybe',
    'level=9',
    'level=two',
    'drafts=show',
    'person=no%20spaces',
    'person=',
    'repo=Not_A_Slug',
  ])('%s answers 400', async (query) => {
    const response = await app.inject({ method: 'GET', url: `/api/board?${query}` });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: expect.any(String) } });
  });
});
