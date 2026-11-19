import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { expect, test } from 'vitest';
import { ownerIsGone, ownerOfThisProcess, parseCreatedAt } from './sandbox-containers.ts';

test('an owner is gone only when its process on this host no longer runs', () => {
  expect(ownerIsGone(ownerOfThisProcess())).toBe(false);
  const ended = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  expect(ownerIsGone(`${hostname()}:${ended}`)).toBe(true);
  // Another host's process, and a container without an owner, are judged by age only.
  expect(ownerIsGone(`not-${hostname()}:${ended}`)).toBe(false);
  expect(ownerIsGone('')).toBe(false);
});

test('reads the creation time docker ps prints', () => {
  expect(parseCreatedAt('2026-11-19 22:49:53 +0100 CET')).toBe(Date.parse('2026-11-19T21:49:53Z'));
  expect(parseCreatedAt('2026-11-19 22:49:53 -0530 X')).toBe(Date.parse('2026-11-20T04:19:53Z'));
});

test('an unreadable time is never stale', () => {
  expect(parseCreatedAt('')).toBeNaN();
  expect(parseCreatedAt('About an hour ago')).toBeNaN();
});
