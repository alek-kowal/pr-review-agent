// S-17-T5: `GET /api/search?q=` matches PRs on number, title words and author. Other test files
// share the database, so the queries use words unique to this file.
import { closeDb, createDb, upsertRepository, type Repository } from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl, uniqueId } from '@pra/db/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { SearchResponse } from '../../src/routes/api/search/index.ts';
import { build } from '../helper.ts';
import { seedPr } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 3 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
beforeEach(async () => {
  app = await build({ db });
});

const word = `zebra${uniqueId()}`;
const login = `ola-${uniqueId()}`;
const memberName = `Aleksandra ${uniqueId()}`;
let repository: Repository;
// PR numbers no other test file uses.
const numbers = { exact: 272_000 + Math.floor(Math.random() * 900), other: 0, author: 0 };

beforeAll(async () => {
  repository = await upsertRepository(db, aRepositoryConfig());
  await seedTeamMember(db, { name: memberName, githubLogin: login });
  numbers.other = numbers.exact * 10 + 1;
  numbers.author = numbers.exact * 10 + 2;
  // A newer PR whose title holds the number comes after the exact match.
  await seedPr(db, repository.id, {
    number: numbers.other,
    title: `Mention ${numbers.exact} and ${word} grouping`,
    openedAt: new Date('2026-11-10T10:00:00Z'),
  });
  await seedPr(db, repository.id, {
    number: numbers.exact,
    title: `Add ${word} edge labels`,
    openedAt: new Date('2026-11-01T10:00:00Z'),
  });
  await seedPr(db, repository.id, {
    number: numbers.author,
    title: 'Speed up layout',
    authorLogin: login,
    state: 'closed',
  });
});

async function search(q: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/search?q=${encodeURIComponent(q)}`,
  });
  expect(response.statusCode).toBe(200);
  return SearchResponse.parse(response.json()).pullRequests;
}

const numbersOf = (hits: { number: number }[]) => hits.map((hit) => hit.number);

describe('GET /api/search', () => {
  test('a number lists that PR first', async () => {
    const hits = await search(String(numbers.exact));
    expect(hits[0]).toMatchObject({
      repository: { slug: repository.slug },
      number: numbers.exact,
      title: `Add ${word} edge labels`,
    });
    expect(numbersOf(hits)).toContain(numbers.other);
    expect(numbersOf(await search(`#${numbers.exact}`))[0]).toBe(numbers.exact);
  });

  test('title words match in any order and case, every word must match', async () => {
    expect(numbersOf(await search(`LABELS ${word}`))).toEqual([numbers.exact]);
    expect(numbersOf(await search(word)).sort()).toEqual([numbers.exact, numbers.other].sort());
    expect(await search(`${word} nothing-like-this`)).toEqual([]);
  });

  test('the author matches by GitHub login or Team name', async () => {
    const byLogin = await search(login);
    expect(numbersOf(byLogin)).toEqual([numbers.author]);
    expect(byLogin[0]).toMatchObject({
      author: { login, name: memberName },
      state: 'closed',
    });
    expect(numbersOf(await search(memberName))).toEqual([numbers.author]);
  });

  test('LIKE wildcards are plain text, and an empty query finds nothing', async () => {
    expect(await search('%')).toEqual([]);
    expect(await search(`${word}_`)).toEqual([]);
    expect(await search('   ')).toEqual([]);
  });

  test('a query over 200 characters answers 400', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/search?q=${'a'.repeat(201)}` });
    expect(response.statusCode).toBe(400);
  });
});
