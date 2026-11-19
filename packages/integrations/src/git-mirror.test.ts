import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { CliGitMirror, gitAuthEnv, parseChangedFiles, type GitExec } from './git-mirror.ts';

const REPO = 'synergycodes/workflowbuilder';
const TOKEN = 'ghs_never_in_argv_0123456789';

/** Commits without the machine's git config (signing, hooks, templates). */
const isolated = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
const git = async (cwd: string, ...args: string[]) =>
  (await execa('git', args, { cwd, env: isolated })).stdout.trim();

let root: string;
let source: string;
let baseSha: string;
let headSha: string;
let mainSha: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pra-git-'));
  source = path.join(root, 'source');
  await execa('git', ['init', '--quiet', '--initial-branch=main', source], { env: isolated });
  await writeFile(path.join(source, 'a.txt'), 'one\ntwo\nthree\n');
  await writeFile(path.join(source, 'b.txt'), 'remove me\n');
  await writeFile(path.join(source, 'old-name.txt'), 'same content for the rename\n'.repeat(5));
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'base');
  baseSha = await git(source, 'rev-parse', 'HEAD');

  await git(source, 'switch', '--quiet', '-c', 'feature');
  await writeFile(path.join(source, 'a.txt'), 'one\nTWO\nthree\nfour\n');
  await writeFile(path.join(source, 'c.txt'), 'new file\n');
  await git(source, 'rm', '--quiet', 'b.txt');
  await git(source, 'mv', 'old-name.txt', 'new-name.txt');
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'feature');
  headSha = await git(source, 'rev-parse', 'HEAD');

  // main moves on after the branch point; the PR diff must not show this change.
  await git(source, 'switch', '--quiet', 'main');
  await writeFile(path.join(source, 'd.txt'), 'only on main\n');
  await git(source, 'add', '.');
  await git(source, 'commit', '--quiet', '-m', 'main moves on');
  mainSha = await git(source, 'rev-parse', 'HEAD');
});
afterAll(() => rm(root, { recursive: true, force: true }));

/** A mirror cloning from the local source repository, with every command recorded. */
function mirrorWithSpy(dir: string, timeoutMs?: number) {
  const exec = vi.fn<GitExec>(async (file, args, options) => {
    const { stdout } = await execa(file, args, {
      ...options,
      env: { ...options.env, ...isolated },
      stripFinalNewline: false,
    });
    return { stdout };
  });
  const mirror = new CliGitMirror({
    rootDir: path.join(root, dir),
    remoteUrl: () => source,
    exec,
    timeoutMs,
  });
  return { mirror, exec };
}

describe('CliGitMirror', () => {
  test('the worktree is checked out at the requested sha', async () => {
    const { mirror } = mirrorWithSpy('worktree');
    await mirror.ensureMirror(REPO, TOKEN);

    const dir = await mirror.addWorktree(REPO, 'run-1', headSha);

    expect(dir).toBe(path.join(root, 'worktree', 'worktrees', 'run-1'));
    expect(await git(dir, 'rev-parse', 'HEAD')).toBe(headSha);
    expect(await readFile(path.join(dir, 'c.txt'), 'utf8')).toBe('new file\n');
    expect(existsSync(path.join(dir, 'b.txt'))).toBe(false);
  });

  test('worktree changes list edited, added and deleted files with their base content', async () => {
    const { mirror } = mirrorWithSpy('changes');
    await mirror.ensureMirror(REPO, TOKEN);
    const dir = await mirror.addWorktree(REPO, 'run-1', headSha);
    expect(await mirror.worktreeChanges(dir)).toEqual([]);

    await writeFile(path.join(dir, 'a.txt'), 'one\nfixed\n');
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'new.ts'), 'export {};\n');
    await rm(path.join(dir, 'c.txt'));

    expect(await mirror.worktreeChanges(dir)).toEqual([
      { path: 'a.txt', base: 'one\nTWO\nthree\nfour\n' },
      { path: 'c.txt', base: 'new file\n' },
      { path: 'src/new.ts', base: null },
    ]);
  });

  test('worktree changes never take the git dir or its config from the worktree', async () => {
    const { mirror } = mirrorWithSpy('changes-guard');
    await mirror.ensureMirror(REPO, TOKEN);
    const dir = await mirror.addWorktree(REPO, 'run-guard', headSha);
    // What an agent could leave behind: a .git pointing at a repository it wrote, whose config
    // runs a command on `git status`.
    const evil = path.join(dir, 'evil');
    await mkdir(path.join(evil, 'objects'), { recursive: true });
    await mkdir(path.join(evil, 'refs', 'heads'), { recursive: true });
    await writeFile(path.join(evil, 'HEAD'), 'ref: refs/heads/x\n');
    const canary = path.join(root, 'fsmonitor-ran');
    await writeFile(
      path.join(evil, 'config'),
      `[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "touch ${canary}"\n`,
    );
    await writeFile(path.join(dir, '.git'), 'gitdir: evil\n');

    await expect(mirror.worktreeChanges(dir)).rejects.toThrow(/does not point into a mirror/);
    await expect(mirror.worktreeChanges(path.join(root, 'elsewhere'))).rejects.toThrow(
      /Not a run worktree/,
    );
    expect(existsSync(canary)).toBe(false);
  });

  test('the diff runs from the merge base and lists the changed files', async () => {
    const { mirror } = mirrorWithSpy('diff');
    await mirror.ensureMirror(REPO);

    const { patch, files } = await mirror.diff(REPO, mainSha, headSha);

    expect(files).toEqual([
      { path: 'a.txt', status: 'modified', additions: 2, deletions: 1 },
      { path: 'b.txt', status: 'deleted', additions: 0, deletions: 1 },
      { path: 'c.txt', status: 'added', additions: 1, deletions: 0 },
      {
        path: 'new-name.txt',
        previousPath: 'old-name.txt',
        status: 'renamed',
        additions: 0,
        deletions: 0,
      },
    ]);
    expect(patch).toContain('+TWO');
    expect(patch).not.toContain('d.txt');
  });

  test('the worktree is removed, and removing it again is fine', async () => {
    const { mirror } = mirrorWithSpy('remove');
    await mirror.fetch(REPO);
    const dir = await mirror.addWorktree(REPO, 'run-2', baseSha);

    await mirror.removeWorktree(REPO, 'run-2');
    await mirror.removeWorktree(REPO, 'run-2');

    expect(existsSync(dir)).toBe(false);
    const list = await git(mirror.mirrorDir(REPO), 'worktree', 'list', '--porcelain');
    expect(list).not.toContain('run-2');
  });

  test('adding a worktree for the same run again replaces it', async () => {
    const { mirror } = mirrorWithSpy('replace');
    await mirror.fetch(REPO);

    await mirror.addWorktree(REPO, 'run-3', baseSha);
    const dir = await mirror.addWorktree(REPO, 'run-3', headSha);

    expect(await git(dir, 'rev-parse', 'HEAD')).toBe(headSha);
  });

  test('fetch brings in commits pushed after the mirror was made', async () => {
    const { mirror } = mirrorWithSpy('fetch');
    await mirror.fetch(REPO, TOKEN);
    await git(source, 'switch', '--quiet', 'feature');
    await writeFile(path.join(source, 'e.txt'), 'later\n');
    await git(source, 'add', '.');
    await git(source, 'commit', '--quiet', '-m', 'later');
    const laterSha = await git(source, 'rev-parse', 'HEAD');
    await git(source, 'switch', '--quiet', 'main');

    await mirror.fetch(REPO, TOKEN);

    const dir = await mirror.addWorktree(REPO, 'run-4', laterSha);
    expect(await readFile(path.join(dir, 'e.txt'), 'utf8')).toBe('later\n');
  });

  test('the token is never an argument; it travels as an http.extraHeader in the env', async () => {
    const { mirror, exec } = mirrorWithSpy('token');
    await mirror.ensureMirror(REPO, TOKEN);
    await mirror.fetch(REPO, TOKEN);
    await mirror.addWorktree(REPO, 'run-5', headSha);
    await mirror.diff(REPO, baseSha, headSha);
    await mirror.removeWorktree(REPO, 'run-5');

    const basic = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');
    expect(exec.mock.calls.length).toBeGreaterThan(4);
    for (const [file, args] of exec.mock.calls) {
      for (const value of [file, ...args]) {
        expect(value).not.toContain(TOKEN);
        expect(value).not.toContain(basic);
      }
    }
    const clone = exec.mock.calls.find(([, args]) => args[0] === 'clone');
    expect(clone?.[2].env).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
      GIT_TERMINAL_PROMPT: '0',
    });
    // Nothing of the token lands in the mirror's config.
    const config = await readFile(path.join(mirror.mirrorDir(REPO), 'config'), 'utf8');
    expect(config).not.toContain(basic);
  });

  test('names that could escape the root or pass as options are refused', async () => {
    const { mirror } = mirrorWithSpy('names');
    await expect(mirror.ensureMirror('../evil')).rejects.toThrow('Not an owner/name');
    await expect(mirror.ensureMirror('owner/..')).rejects.toThrow('Not an owner/name');
    await expect(mirror.addWorktree(REPO, '../run', headSha)).rejects.toThrow('Not a run id');
    await expect(mirror.addWorktree(REPO, 'run-6', '--upload-pack=x')).rejects.toThrow(
      'Not a commit sha',
    );
    // A short id could name a branch or tag in the mirror instead of the commit.
    await expect(mirror.addWorktree(REPO, 'run-7', headSha.slice(0, 9))).rejects.toThrow(
      'Not a commit sha',
    );
  });

  test('a git command past the timeout is killed and frees the repository for the next one', async () => {
    const { mirror, exec } = mirrorWithSpy('timeout', 1);
    await expect(mirror.ensureMirror(REPO)).rejects.toMatchObject({ timedOut: true });
    expect(exec.mock.calls[0]![2]).toMatchObject({ timeout: 1 });

    const { mirror: patient } = mirrorWithSpy('timeout');
    await expect(patient.ensureMirror(REPO)).resolves.toBeUndefined();
  });
});

test('without a token only the prompt is switched off', () => {
  expect(gitAuthEnv()).toEqual({ GIT_TERMINAL_PROMPT: '0' });
});

test('a path starting with a tab keeps every file on its own line counts', () => {
  const nameStatus = ['M', '\tlead', 'R100', 'old.txt', 'new.txt', 'M', 'z.txt', ''].join('\0');
  const numstat = ['2\t1\t\tlead', '0\t0\t', 'old.txt', 'new.txt', '1\t0\tz.txt', ''].join('\0');
  expect(parseChangedFiles(nameStatus, numstat)).toEqual([
    { path: '\tlead', status: 'modified', additions: 2, deletions: 1 },
    { path: 'new.txt', previousPath: 'old.txt', status: 'renamed', additions: 0, deletions: 0 },
    { path: 'z.txt', status: 'modified', additions: 1, deletions: 0 },
  ]);
});
