// P-27: the nightly disk cleanup keeps what runs in progress need and removes the rest.
import { closeDb, createDb, insertRun, upsertPullRequest, type Db, type Repository } from '@pra/db';
import { aPullRequest, aRun, testDatabaseUrl } from '@pra/db/testing';
import { existsSync, mkdtempSync } from 'node:fs';
import { mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { CACHE_STAMP, cleanupData } from '../src/run/data-cleanup.ts';
import { connectRepository } from './support.ts';

let db: Db;
const dataDir = mkdtempSync(path.join(tmpdir(), 'pra-cleanup-'));
const DAY = 24 * 3_600_000;

beforeAll(() => {
  db = createDb(testDatabaseUrl(), { max: 2 });
});
afterAll(async () => {
  await closeDb(db);
  await rm(dataDir, { recursive: true, force: true });
});

async function runOf(repository: Repository, status: 'running' | 'completed'): Promise<number> {
  const { pullRequest } = await upsertPullRequest(db, aPullRequest(repository.id));
  return (await insertRun(db, aRun(pullRequest.id, { status }))).id;
}

const dir = (...parts: string[]) => path.join(dataDir, ...parts);
async function make(folder: string, ageMs = 0): Promise<string> {
  await mkdir(folder, { recursive: true });
  const at = new Date(Date.now() - ageMs);
  await utimes(folder, at, at);
  return folder;
}
async function stamp(cache: string, ageMs: number): Promise<void> {
  await make(cache);
  await writeFile(path.join(cache, CACHE_STAMP), '');
  const at = new Date(Date.now() - ageMs);
  await utimes(path.join(cache, CACHE_STAMP), at, at);
}

test('keeps what runs in progress need; removes ended runs, old caches and disconnected repos', async () => {
  const busy = await connectRepository(db);
  const idle = await connectRepository(db);
  const running = await runOf(busy, 'running');
  const ended = await runOf(idle, 'completed');

  await make(dir('git', 'worktrees', `run-${running}`, 'node_modules'));
  await make(dir('git', 'worktrees', `run-${ended}`, 'node_modules'));
  await make(dir('git', 'worktrees', 'patch-1'), 7 * 3_600_000);
  await make(dir('git', 'worktrees', 'patch-2'));
  await make(dir('sessions', `run-${running}`));
  await make(dir('sessions', `run-${ended}`));
  await stamp(dir('cache', busy.slug), 30 * DAY);
  await stamp(dir('cache', idle.slug), 30 * DAY);
  await make(dir('cache', 'disconnected-repo'));
  const [owner, name] = idle.githubFullName.split('/') as [string, string];
  await make(dir('git', 'mirrors', owner, `${name}.git`));
  await make(dir('git', 'mirrors', owner, 'disconnected-repo.git'));

  const options = { cacheMaxAgeDays: 7, strayMaxAgeHours: 6 };
  const planned = await cleanupData({ db, dataDir }, { ...options, dryRun: true });
  expect(existsSync(dir('git', 'worktrees', `run-${ended}`))).toBe(true);

  const result = await cleanupData({ db, dataDir }, options);
  expect(result).toEqual(planned);
  expect(result.worktrees.map((p) => path.basename(p)).sort()).toEqual(
    [`run-${ended}`, 'patch-1'].sort(),
  );
  expect(result.sessions.map((p) => path.basename(p))).toEqual([`run-${ended}`]);
  expect(result.caches.map((p) => path.basename(p)).sort()).toEqual(
    ['disconnected-repo', idle.slug].sort(),
  );
  expect(result.mirrors.map((p) => path.basename(p))).toEqual(['disconnected-repo.git']);

  expect(existsSync(dir('git', 'worktrees', `run-${running}`, 'node_modules'))).toBe(true);
  expect(existsSync(dir('git', 'worktrees', 'patch-2'))).toBe(true);
  expect(existsSync(dir('sessions', `run-${running}`))).toBe(true);
  // The busy repository's run may be installing from its cache right now.
  expect(existsSync(dir('cache', busy.slug))).toBe(true);
  expect(existsSync(dir('git', 'mirrors', owner, `${name}.git`))).toBe(true);
});

test('a cache without a stamp gets one and stays', async () => {
  const repository = await connectRepository(db);
  const cache = await make(dir('cache', repository.slug));
  const result = await cleanupData({ db, dataDir }, { cacheMaxAgeDays: 7, strayMaxAgeHours: 6 });
  expect(result.caches).not.toContain(cache);
  expect(existsSync(path.join(cache, CACHE_STAMP))).toBe(true);
});
