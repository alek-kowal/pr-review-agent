import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { writeFiles } from '../src/stages/implementer.ts';

describe('writeFiles', () => {
  let root: string;
  let worktree: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pra-patch-files-'));
    worktree = path.join(root, 'worktree');
    outside = path.join(root, 'outside');
    await mkdir(path.join(worktree, 'src'), { recursive: true });
    await mkdir(outside);
    await writeFile(path.join(outside, 'kept.txt'), 'kept\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test('writes and deletes files inside the worktree', async () => {
    await writeFile(path.join(worktree, 'src', 'old.ts'), 'old\n');
    await writeFiles(worktree, [
      { path: 'src/new/a.ts', content: 'a\n' },
      { path: 'src/old.ts', content: null },
    ]);
    expect(await readFile(path.join(worktree, 'src', 'new', 'a.ts'), 'utf8')).toBe('a\n');
    expect(existsSync(path.join(worktree, 'src', 'old.ts'))).toBe(false);
  });

  test.each(['../outside/x.txt', '.git', '.git/config'])('refuses %s', async (file) => {
    await expect(writeFiles(worktree, [{ path: file, content: 'x' }])).rejects.toThrow(
      /outside the worktree/,
    );
  });

  test('never writes or deletes through a symlinked folder of the commit', async () => {
    await symlink(outside, path.join(worktree, 'docs'));
    await expect(writeFiles(worktree, [{ path: 'docs/x.txt', content: 'x' }])).rejects.toThrow(
      /symlink/,
    );
    await expect(writeFiles(worktree, [{ path: 'docs/kept.txt', content: null }])).rejects.toThrow(
      /symlink/,
    );
    expect(existsSync(path.join(outside, 'x.txt'))).toBe(false);
    expect(await readFile(path.join(outside, 'kept.txt'), 'utf8')).toBe('kept\n');
  });

  test('never writes through a symlinked file, but may delete the link itself', async () => {
    await symlink(path.join(outside, 'kept.txt'), path.join(worktree, 'link.txt'));
    await expect(writeFiles(worktree, [{ path: 'link.txt', content: 'x' }])).rejects.toThrow(
      /symlink/,
    );
    await writeFiles(worktree, [{ path: 'link.txt', content: null }]);
    expect(existsSync(path.join(worktree, 'link.txt'))).toBe(false);
    expect(await readFile(path.join(outside, 'kept.txt'), 'utf8')).toBe('kept\n');
  });
});
