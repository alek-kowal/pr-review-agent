import { execa } from 'execa';
import { mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CliGitMirror,
  noreplyEmail,
  PUSH_COMMIT_MESSAGE,
  type GitExec,
  type PushPatchInput,
} from './git-mirror.ts';
import {
  createGitFixture,
  ISOLATED_GIT_ENV,
  isolatedGitExec,
  type GitFixture,
} from './testing/index.ts';

const TOKEN = 'ghs_secret_installation_token';
const BOT = { name: 'pr-review-agent[bot]', email: noreplyEmail(41, 'pr-review-agent[bot]') };
const KASIA = { name: 'Kasia', email: noreplyEmail(7, 'kasia') };
const FINDING_TITLE = 'Null check missing in parseEdge';

let root: string;
let fixture: GitFixture;
let bare: string;

const git = async (dir: string, ...args: string[]) =>
  (await execa('git', ['-C', dir, ...args], { env: ISOLATED_GIT_ENV })).stdout.trim();

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'pra-push-'));
  fixture = await createGitFixture();
  bare = path.join(root, 'remote.git');
  await execa('git', ['clone', '--quiet', '--bare', fixture.dir, bare], { env: ISOLATED_GIT_ENV });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await fixture.remove();
});

function mirror(dir: string) {
  const exec = vi.fn<GitExec>(isolatedGitExec);
  return { exec, mirror: new CliGitMirror({ rootDir: dir, remoteUrl: () => bare, exec }) };
}

const input = (overrides: Partial<PushPatchInput> = {}): PushPatchInput => ({
  repo: 'acme/widgets',
  branch: 'feature',
  baseSha: fixture.headSha,
  files: [{ path: 'src/fix.ts', content: 'export const fixed = true;\n' }],
  message: PUSH_COMMIT_MESSAGE,
  author: BOT,
  coAuthor: KASIA,
  date: new Date('2026-11-19T10:00:00Z'),
  token: TOKEN,
  ...overrides,
});

describe('pushPatch', () => {
  it('pushes one commit by the bot with the signer as co-author, never forced', async () => {
    const { exec, mirror: m } = mirror(path.join(root, 'one'));
    await m.fetch('acme/widgets', TOKEN);

    const result = await m.pushPatch(input());

    expect(result).toEqual({ ok: true, sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
    const sha = result.ok ? result.sha : '';
    expect(await git(bare, 'rev-parse', 'refs/heads/feature')).toBe(sha);
    expect(await git(bare, 'rev-parse', `${sha}^`)).toBe(fixture.headSha);
    expect(await git(bare, 'log', '-1', '--format=%an <%ae>|%cn <%ce>', sha)).toBe(
      `${BOT.name} <${BOT.email}>|${BOT.name} <${BOT.email}>`,
    );
    const message = await git(bare, 'log', '-1', '--format=%B', sha);
    expect(message).toContain(`Co-authored-by: Kasia <${KASIA.email}>`);
    expect(await git(bare, 'show', `${sha}:src/fix.ts`)).toBe('export const fixed = true;');

    const argv = exec.mock.calls.flatMap(([, args]) => args);
    expect(argv.join(' ')).not.toContain(TOKEN);
    const pushes = exec.mock.calls.filter(([, args]) => args.includes('push'));
    expect(pushes).toHaveLength(1);
    const pushArgv = pushes[0]![1];
    expect(pushArgv.some((arg) => arg.startsWith('--force') || arg === '-f')).toBe(false);
    expect(pushArgv.some((arg) => arg.startsWith('+') || arg.includes(':+'))).toBe(false);
    expect(pushes[0]![1]).not.toContain('origin');
    expect(pushes[0]![2].env).toMatchObject({ GIT_CONFIG_KEY_0: 'http.extraHeader' });
  });

  it('refuses with head_moved when the branch moved, leaving the remote unchanged', async () => {
    const { mirror: m } = mirror(path.join(root, 'two'));
    // A person pushed on top of the PR head; this test does not rely on another test's push.
    const theirs = await git(
      bare,
      'commit-tree',
      `${fixture.headSha}^{tree}`,
      '-p',
      fixture.headSha,
      '-m',
      'their commit',
    );
    await git(bare, 'update-ref', 'refs/heads/feature', theirs);
    await m.fetch('acme/widgets', TOKEN);
    const before = await git(bare, 'rev-parse', 'refs/heads/feature');

    // The patch was made on the PR head before the last push.
    const result = await m.pushPatch(input({ files: [{ path: 'src/late.ts', content: 'x\n' }] }));

    expect(result).toEqual({ ok: false, reason: 'head_moved' });
    expect(await git(bare, 'rev-parse', 'refs/heads/feature')).toBe(before);
  });

  it('writes a neutral message without finding text or an address', async () => {
    const { mirror: m } = mirror(path.join(root, 'three'));
    await m.fetch('acme/widgets', TOKEN);
    const head = await git(bare, 'rev-parse', 'refs/heads/feature');

    const result = await m.pushPatch(
      input({ baseSha: head, coAuthor: null, files: [{ path: 'neutral.txt', content: 'n\n' }] }),
    );

    const sha = result.ok ? result.sha : '';
    const message = await git(bare, 'log', '-1', '--format=%B', sha);
    expect(message.trim()).toBe(PUSH_COMMIT_MESSAGE);
    expect(message).not.toContain(FINDING_TITLE);
    expect(message).not.toMatch(/https?:\/\//);
  });

  it('gives the same commit for the same patch, so a retry pushes nothing new', async () => {
    const { mirror: m } = mirror(path.join(root, 'four'));
    await m.fetch('acme/widgets', TOKEN);
    const head = await git(bare, 'rev-parse', 'refs/heads/feature');
    const patch = input({ baseSha: head, files: [{ path: 'retry.txt', content: 'same\n' }] });

    const first = await m.pushPatch(patch);
    const second = await m.pushPatch(patch);

    expect(second).toEqual(first);
    expect(await git(bare, 'rev-list', '--count', `${head}..refs/heads/feature`)).toBe('1');
  });

  it('refuses a path outside the repository and a branch that looks like an option', async () => {
    const { mirror: m } = mirror(path.join(root, 'five'));
    await m.fetch('acme/widgets', TOKEN);
    await expect(
      m.pushPatch(input({ files: [{ path: '../escape.txt', content: 'x' }] })),
    ).rejects.toThrow(/inside the repository/);
    await expect(m.pushPatch(input({ branch: '+feature' }))).rejects.toThrow(/branch/);
  });

  it('never writes through a folder that the PR made a symbolic link', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'pra-outside-'));
    const clone = path.join(root, 'linked-clone');
    await execa('git', ['clone', '--quiet', bare, clone], { env: ISOLATED_GIT_ENV });
    await symlink(outside, path.join(clone, 'linked'));
    await git(clone, 'add', 'linked');
    await git(clone, 'commit', '--quiet', '-m', 'link out');
    await git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/linked');
    const linkedSha = await git(clone, 'rev-parse', 'HEAD');
    const { mirror: m } = mirror(path.join(root, 'six'));
    await m.fetch('acme/widgets', TOKEN);

    await expect(
      m.pushPatch(
        input({
          branch: 'linked',
          baseSha: linkedSha,
          files: [{ path: 'linked/evil.txt', content: 'x' }],
        }),
      ),
    ).rejects.toThrow(/inside the repository/);
    expect(await readdir(outside)).toEqual([]);
    await rm(outside, { recursive: true, force: true });
  });
});
