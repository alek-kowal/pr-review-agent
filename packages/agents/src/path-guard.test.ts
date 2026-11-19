import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkToolPath, type PathPolicy } from './path-guard.ts';

describe('checkToolPath', () => {
  let root: string;
  let policy: PathPolicy;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pra-path-guard-'));
    const cwd = path.join(root, 'worktree');
    await mkdir(path.join(cwd, 'src'), { recursive: true });
    await writeFile(path.join(cwd, '.git'), 'gitdir: /elsewhere\n');
    await writeFile(path.join(cwd, 'src', 'a.ts'), 'export {};\n');
    policy = { cwd, readDirs: [] };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('lets the implementer write a file of the worktree', async () => {
    expect(await checkToolPath(policy, 'Write', { file_path: 'src/a.ts' })).toEqual({
      allowed: true,
    });
    expect(await checkToolPath(policy, 'Edit', { file_path: 'src/new/b.ts' })).toEqual({
      allowed: true,
    });
  });

  it.each(['.git', '.GIT', 'src/../.git', '.git/config', 'evil/.git/config', 'src/.Git/HEAD'])(
    'never lets a session write %s, which picks the git dir host commands use',
    async (file) => {
      const decision = await checkToolPath(policy, 'Write', { file_path: file });
      expect(decision.allowed).toBe(false);
    },
  );

  it('still lets a session read the .git file', async () => {
    expect(await checkToolPath(policy, 'Read', { file_path: '.git' })).toEqual({ allowed: true });
  });

  it('refuses writes outside the worktree and through a symlink', async () => {
    await symlink(root, path.join(policy.cwd, 'out'));
    expect((await checkToolPath(policy, 'Write', { file_path: '../x.ts' })).allowed).toBe(false);
    expect((await checkToolPath(policy, 'Write', { file_path: 'out' })).allowed).toBe(false);
    expect((await checkToolPath(policy, 'Write', { file_path: '/etc/hosts' })).allowed).toBe(false);
  });
});
