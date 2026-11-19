import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';

/**
 * One bare mirror per repository and one detached worktree per run, through the git CLI.
 * Every method names the repository, because one worker serves many.
 */
export interface GitMirror {
  /** Clones the mirror when it does not exist yet. */
  ensureMirror(fullName: string, token?: string): Promise<void>;
  /** Updates every ref of the mirror (branches and `refs/pull/*`), cloning it first if needed. */
  fetch(fullName: string, token?: string): Promise<void>;
  /** Checks out `sha` in the run's own worktree and returns its path. Replaces an older one. */
  addWorktree(fullName: string, runId: string, sha: string): Promise<string>;
  /** The PR diff: from the merge base of `baseSha` and `headSha` to `headSha`. */
  diff(fullName: string, baseSha: string, headSha: string): Promise<GitDiff>;
  /** Removes the run's worktree; a missing one is fine. */
  removeWorktree(fullName: string, runId: string): Promise<void>;
  /**
   * Files that differ from the worktree's checked-out commit (edited, added or deleted, untracked
   * included, ignored files not), each with its content at that commit (`null` when added).
   */
  worktreeChanges(worktree: string): Promise<WorktreeChange[]>;
}

export type WorktreeChange = { path: string; base: string | null };

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'changed';

export type ChangedFile = {
  path: string;
  /** The old path of a renamed or copied file. */
  previousPath?: string;
  status: ChangedFileStatus;
  /** `null` for binary files. */
  additions: number | null;
  deletions: number | null;
};

export type GitDiff = { patch: string; files: ChangedFile[] };

/** Runs a command and kills it after `timeout` ms; the default is `execa`. Tests pass a spy. */
export type GitExec = (
  file: string,
  args: string[],
  options: { cwd?: string; env: Record<string, string>; timeout: number },
) => Promise<{ stdout: string }>;

export type CliGitMirrorOptions = {
  /** Holds `mirrors/<owner>/<repo>.git` and `worktrees/<runId>`; the worker passes `.data/git`. */
  rootDir: string;
  /** Where to clone from; default `https://github.com/<fullName>.git`. */
  remoteUrl?: (fullName: string) => string;
  exec?: GitExec;
  /** Per git command, default `DEFAULT_GIT_TIMEOUT_MS`. */
  timeoutMs?: number;
};

export const DEFAULT_GIT_DIR = '.data/git';
/**
 * A stalled clone or fetch never ends by itself (git has no network timeout by default) and would
 * hold its repository's lock until the worker restarts, so every git command has a deadline.
 */
export const DEFAULT_GIT_TIMEOUT_MS = 15 * 60_000;

const NAME_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const RUN_ID = /^[A-Za-z0-9_-]+$/;
/** Full object ids only (SHA-1 or SHA-256): git may read a short one as a branch or tag name. */
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const STATUS: Record<string, ChangedFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'changed',
};

const defaultExec: GitExec = async (file, args, options) => {
  const { stdout } = await execa(file, args, {
    ...options,
    stripFinalNewline: false,
    forceKillAfterDelay: 5_000,
  });
  return { stdout };
};

/**
 * The installation token travels in the environment as an `http.extraHeader`, never in argv
 * (argv is visible to every process on the host) and never in the mirror's config.
 */
export function gitAuthEnv(token?: string): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  if (!token) return env;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    ...env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

export class CliGitMirror implements GitMirror {
  readonly rootDir: string;
  readonly #remoteUrl: (fullName: string) => string;
  readonly #exec: GitExec;
  readonly #timeoutMs: number;
  /** Git takes file locks per repository; operations on one mirror run one at a time. */
  readonly #locks = new Map<string, Promise<unknown>>();

  constructor(options: CliGitMirrorOptions) {
    this.rootDir = path.resolve(options.rootDir);
    this.#remoteUrl = options.remoteUrl ?? ((fullName) => `https://github.com/${fullName}.git`);
    this.#exec = options.exec ?? defaultExec;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  }

  mirrorDir(fullName: string): string {
    const [owner, repo, ...rest] = fullName.split('/');
    const valid = [owner, repo].every(
      (segment) => segment && NAME_SEGMENT.test(segment) && segment !== '.' && segment !== '..',
    );
    if (!valid || rest.length > 0) {
      throw new TypeError(`Not an owner/name repository: ${JSON.stringify(fullName)}`);
    }
    return path.join(this.rootDir, 'mirrors', owner!, `${repo}.git`);
  }

  worktreeDir(runId: string): string {
    if (!RUN_ID.test(runId)) throw new TypeError(`Not a run id: ${JSON.stringify(runId)}`);
    return path.join(this.rootDir, 'worktrees', runId);
  }

  async ensureMirror(fullName: string, token?: string): Promise<void> {
    await this.#locked(fullName, () => this.#ensureMirror(fullName, token));
  }

  async fetch(fullName: string, token?: string): Promise<void> {
    return this.#locked(fullName, async () => {
      if (await this.#ensureMirror(fullName, token)) return;
      await this.#git(this.mirrorDir(fullName), ['fetch', '--prune', 'origin'], token);
    });
  }

  async addWorktree(fullName: string, runId: string, sha: string): Promise<string> {
    assertSha(sha);
    const dir = this.worktreeDir(runId);
    return this.#locked(fullName, async () => {
      await this.#removeWorktree(fullName, dir);
      await mkdir(path.dirname(dir), { recursive: true });
      await this.#git(this.mirrorDir(fullName), ['worktree', 'add', '--detach', dir, sha]);
      return dir;
    });
  }

  async diff(fullName: string, baseSha: string, headSha: string): Promise<GitDiff> {
    assertSha(baseSha);
    assertSha(headSha);
    const mirror = this.mirrorDir(fullName);
    const range = `${baseSha}...${headSha}`;
    const common = ['diff', '--no-color', '--no-ext-diff', '--find-renames'];
    const [patch, nameStatus, numstat] = await Promise.all([
      this.#git(mirror, [...common, range]),
      this.#git(mirror, [...common, '-z', '--name-status', range]),
      this.#git(mirror, [...common, '-z', '--numstat', range]),
    ]);
    return { patch, files: parseChangedFiles(nameStatus, numstat) };
  }

  async removeWorktree(fullName: string, runId: string): Promise<void> {
    const dir = this.worktreeDir(runId);
    return this.#locked(fullName, () => this.#removeWorktree(fullName, dir));
  }

  async worktreeChanges(worktree: string): Promise<WorktreeChange[]> {
    const status = await this.#git(worktree, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
    ]);
    // Each entry is "XY <path>"; without renames there is never a second path.
    const paths = status
      .split('\0')
      .filter((entry) => entry.length > 3)
      .map((entry) => entry.slice(3));
    const changes: WorktreeChange[] = [];
    for (const file of [...new Set(paths)].sort()) {
      const base = await this.#git(worktree, ['show', `HEAD:${file}`]).catch(() => null);
      changes.push({ path: file, base });
    }
    return changes;
  }

  /** Clones the mirror if it is missing; returns whether it cloned. */
  async #ensureMirror(fullName: string, token?: string): Promise<boolean> {
    const dir = this.mirrorDir(fullName);
    if (existsSync(path.join(dir, 'HEAD'))) return false;
    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    try {
      await this.#git(
        undefined,
        ['clone', '--mirror', '--', this.#remoteUrl(fullName), dir],
        token,
      );
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    return true;
  }

  async #removeWorktree(fullName: string, dir: string): Promise<void> {
    const mirror = this.mirrorDir(fullName);
    if (existsSync(dir) && existsSync(mirror)) {
      await this.#git(mirror, ['worktree', 'remove', '--force', dir]).catch(() => undefined);
    }
    await rm(dir, { recursive: true, force: true });
    if (existsSync(mirror)) await this.#git(mirror, ['worktree', 'prune']);
  }

  async #git(gitDir: string | undefined, args: string[], token?: string): Promise<string> {
    const fullArgs = gitDir ? ['-C', gitDir, ...args] : args;
    const { stdout } = await this.#exec('git', fullArgs, {
      env: gitAuthEnv(token),
      timeout: this.#timeoutMs,
    });
    return stdout;
  }

  #locked<T>(fullName: string, task: () => Promise<T>): Promise<T> {
    const key = this.mirrorDir(fullName);
    const previous = this.#locks.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.#locks.set(key, settled);
    void settled.then(() => {
      if (this.#locks.get(key) === settled) this.#locks.delete(key);
    });
    return next;
  }
}

function assertSha(sha: string): void {
  if (!SHA.test(sha)) throw new TypeError(`Not a commit sha: ${JSON.stringify(sha)}`);
}

/** Joins `--name-status -z` and `--numstat -z` output; both list files in the same order. */
export function parseChangedFiles(nameStatus: string, numstat: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const statusParts = nameStatus.split('\0');
  for (let i = 0; i < statusParts.length - 1;) {
    const code = statusParts[i++]!;
    const letter = code[0]!;
    if (letter === 'R' || letter === 'C') {
      const previousPath = statusParts[i++]!;
      files.push({
        path: statusParts[i++]!,
        previousPath,
        status: STATUS[letter]!,
        additions: null,
        deletions: null,
      });
    } else {
      files.push({
        path: statusParts[i++]!,
        status: STATUS[letter] ?? 'changed',
        additions: null,
        deletions: null,
      });
    }
  }

  const countParts = numstat.split('\0');
  let index = 0;
  for (let i = 0; i < countParts.length - 1 && index < files.length; index++) {
    const record = countParts[i++]!;
    const [added, deleted] = record.split('\t', 2);
    // `added<TAB>deleted<TAB>path`; a rename has an empty path here, followed by the old and the
    // new path. Split only twice: a path may itself start with a tab.
    const inlinePath = record.slice(`${added}\t${deleted}\t`.length);
    if (inlinePath === '') i += 2;
    const file = files[index]!;
    file.additions = added === '-' ? null : Number(added);
    file.deletions = deleted === '-' ? null : Number(deleted);
  }
  return files;
}
