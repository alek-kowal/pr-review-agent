import { execa } from 'execa';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { GitExec } from '../git-mirror.ts';

/** Git without the machine's config (signing, hooks, templates) and with a fixed author. */
export const ISOLATED_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

/** A `GitExec` for `CliGitMirror` that runs git with `ISOLATED_GIT_ENV`. */
export const isolatedGitExec: GitExec = async (file, args, options) => {
  const { stdout } = await execa(file, args, {
    ...options,
    env: { ...options.env, ...ISOLATED_GIT_ENV },
    stripFinalNewline: false,
  });
  return { stdout };
};

/** File contents by repository path; `null` deletes the file. */
export type GitFiles = Record<string, string | null>;

export type GitFixture = {
  /** The repository; pass it as `CliGitMirror`'s `remoteUrl`. */
  dir: string;
  /** `main` before the feature branch. */
  baseSha: string;
  /** The feature commit (branch `feature`). */
  headSha: string;
  /** The `fixes` commits on `feature` after `headSha`, in order. */
  fixShas: string[];
  remove: () => Promise<void>;
};

/** A small WB-like monorepo: two workspaces with their documents. */
export const DEFAULT_BASE_FILES: GitFiles = {
  'README.md': '# Workflow Builder\n',
  'apps/demo/README.md': '# Demo app\n',
  'apps/demo/src/edges.ts': 'export const label = (edge: { name: string }) => edge.name;\n',
  'packages/sdk/CLAUDE.md': '# SDK rules\n',
  'packages/sdk/src/index.ts': "export * from './store.ts';\n",
  'packages/sdk/src/store.ts': 'export const store = new Map<string, string>();\n',
};

export const DEFAULT_FEATURE_FILES: GitFiles = {
  'apps/demo/src/edges.ts':
    'export const label = (edge: { name: string }) => edge.name.trim();\n' +
    'export const rename = (edge: { name: string }, name: string) => ({ ...edge, name });\n',
  'packages/sdk/src/index.ts': "export * from './store.ts';\nexport * from './edges.ts';\n",
  'packages/sdk/src/edges.ts': 'export type EdgeLabel = string;\n',
};

/**
 * A local git repository in a temp dir with `base` committed on `main` and `feature` committed on
 * branch `feature`, then one commit per `fixes` entry on top of it (pushes after the reviewed
 * head), built with an isolated git config. No network.
 */
export async function createGitFixture(
  options: { base?: GitFiles; feature?: GitFiles; fixes?: GitFiles[] } = {},
): Promise<GitFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'pra-git-fixture-'));
  const dir = path.join(root, 'repo');
  const git = async (...args: string[]) =>
    (await execa('git', args, { cwd: dir, env: ISOLATED_GIT_ENV })).stdout.trim();

  await mkdir(dir);
  await git('init', '--quiet', '--initial-branch=main');
  await writeFiles(dir, options.base ?? DEFAULT_BASE_FILES);
  await git('add', '--all');
  await git('commit', '--quiet', '-m', 'base');
  const baseSha = await git('rev-parse', 'HEAD');

  await git('switch', '--quiet', '-c', 'feature');
  await writeFiles(dir, options.feature ?? DEFAULT_FEATURE_FILES);
  await git('add', '--all');
  await git('commit', '--quiet', '--allow-empty', '-m', 'feature');
  const headSha = await git('rev-parse', 'HEAD');
  const fixShas: string[] = [];
  for (const [i, files] of (options.fixes ?? []).entries()) {
    await writeFiles(dir, files);
    await git('add', '--all');
    await git('commit', '--quiet', '--allow-empty', '-m', `fix ${i + 1}`);
    fixShas.push(await git('rev-parse', 'HEAD'));
  }
  await git('switch', '--quiet', 'main');

  return {
    dir,
    baseSha,
    headSha,
    fixShas,
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

async function writeFiles(dir: string, files: GitFiles): Promise<void> {
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(dir, file);
    if (content === null) {
      await rm(full, { force: true });
      continue;
    }
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}
