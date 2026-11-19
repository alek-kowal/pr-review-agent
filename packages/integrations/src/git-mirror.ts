import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
  /** Puts a run's worktree back at its checked-out commit, byte for byte; ignored files stay. */
  resetWorktree(worktree: string): Promise<void>;
  /**
   * Commits `files` on top of `baseSha` in a fresh worktree and pushes that commit to `branch`,
   * never forced: when the branch is no longer `baseSha` (or a descendant git can fast-forward
   * from), git refuses and the result is `head_moved` with the remote unchanged. A remote that
   * declines the update (branch protection, rulesets, hooks) gives `remote_rejected`.
   */
  pushPatch(input: PushPatchInput): Promise<PushPatchResult>;
  /**
   * The commit `pushPatch` makes for this input, built but not pushed. The same input always
   * gives the same SHA, so a retried push job can tell its own landed commit from a moved head.
   */
  patchCommit(input: PatchCommitInput): Promise<string>;
}

export type WorktreeChange = { path: string; base: string | null };

/** A git author or committer. */
export type GitIdentity = { name: string; email: string };

export type PushPatchInput = {
  /** `owner/name` of the repository the PR branch lives in. */
  repo: string;
  /** The PR branch, without `refs/heads/`. */
  branch: string;
  /** The commit the patch was made on; the new commit's only parent. */
  baseSha: string;
  /** The patch: each file's new content, or `null` to delete it. */
  files: readonly { path: string; content: Uint8Array | string | null }[];
  message: string;
  /** The App's bot: author and committer of the commit. */
  author: GitIdentity;
  /** The person who signed the push, as a `Co-authored-by` trailer; none for autofix. */
  coAuthor?: GitIdentity | null;
  /**
   * Author and committer date. The same patch always gives the same commit, so a retried push
   * sends a commit the branch already has instead of a second one.
   */
  date: Date;
  token?: string;
};

/** What builds the commit: the push input without its target branch and token. */
export type PatchCommitInput = Omit<PushPatchInput, 'branch' | 'token'>;

export type PushPatchResult =
  { ok: true; sha: string } | { ok: false; reason: 'head_moved' | 'remote_rejected' };

/**
 * The commit message of every pushed patch. It never names a finding, a decision or the app's
 * address, because a public PR shows it to everyone (NFR Privacy).
 */
export const PUSH_COMMIT_MESSAGE = 'Apply fixes from pr-review-agent review';

/** `Co-authored-by: Name <email>`, the trailer GitHub reads to credit the signer. */
export function coAuthorTrailer(identity: GitIdentity): string {
  return `Co-authored-by: ${identity.name} <${identity.email}>`;
}

/** GitHub's private commit address of an account: `<id>+<login>@users.noreply.github.com`. */
export function noreplyEmail(id: number, login: string): string {
  return `${id}+${login}@users.noreply.github.com`;
}

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
/** A branch name git accepts, without a leading `-`, `+` or `:` that argv could misread. */
const BRANCH = /^[A-Za-z0-9_.][A-Za-z0-9_./-]*$/;

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
    const git = await this.#worktreeGit(worktree);
    const status = await git([
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
      const base = await git(['show', `HEAD:${file}`]).catch(() => null);
      changes.push({ path: file, base });
    }
    return changes;
  }

  async pushPatch(input: PushPatchInput): Promise<PushPatchResult> {
    if (!BRANCH.test(input.branch) || input.branch.includes('..')) {
      throw new TypeError(`Not a branch name: ${JSON.stringify(input.branch)}`);
    }
    return this.#withPatchCommit(input, async (sha) => {
      // To the URL, never to `origin`: the mirror's remote has `mirror = true`, which would add
      // git's mirror and force flags. No `--force`, no `--force-with-lease`, no `+` refspec.
      try {
        await this.#git(
          this.mirrorDir(input.repo),
          [
            'push',
            '--porcelain',
            '--no-verify',
            this.#remoteUrl(input.repo),
            `${sha}:refs/heads/${input.branch}`,
          ],
          input.token,
        );
      } catch (error) {
        const rejection = rejectionOf(error);
        if (rejection) return { ok: false, reason: rejection };
        throw error;
      }
      return { ok: true, sha };
    });
  }

  async patchCommit(input: PatchCommitInput): Promise<string> {
    return this.#withPatchCommit(input, async (sha) => sha);
  }

  /** Builds the patch's commit in a fresh worktree at `baseSha` and hands its SHA to `then`. */
  async #withPatchCommit<T>(input: PatchCommitInput, then: (sha: string) => Promise<T>) {
    assertSha(input.baseSha);
    const mirror = this.mirrorDir(input.repo);
    const dir = this.worktreeDir(`push-${randomUUID()}`);
    return this.#locked(input.repo, async () => {
      await mkdir(path.dirname(dir), { recursive: true });
      await this.#git(mirror, ['worktree', 'add', '--detach', dir, input.baseSha]);
      try {
        for (const file of input.files) await writeWorktreeFile(dir, file.path, file.content);
        await this.#git(dir, ['add', '--all']);
        const when = `${Math.floor(input.date.getTime() / 1000)} +0000`;
        const identity = {
          GIT_AUTHOR_NAME: input.author.name,
          GIT_AUTHOR_EMAIL: input.author.email,
          GIT_AUTHOR_DATE: when,
          GIT_COMMITTER_NAME: input.author.name,
          GIT_COMMITTER_EMAIL: input.author.email,
          GIT_COMMITTER_DATE: when,
        };
        const message = ['-m', input.message];
        if (input.coAuthor) message.push('-m', coAuthorTrailer(input.coAuthor));
        await this.#git(
          dir,
          ['commit', '--no-verify', '--no-gpg-sign', '--cleanup=verbatim', ...message],
          undefined,
          identity,
        );
        return await then((await this.#git(dir, ['rev-parse', 'HEAD'])).trim());
      } finally {
        await this.#removeWorktree(input.repo, dir);
      }
    });
  }

  async resetWorktree(worktree: string): Promise<void> {
    const git = await this.#worktreeGit(worktree);
    await git(['reset', '--hard', '--quiet', 'HEAD']);
    await git(['clean', '-d', '--force', '--quiet']);
  }

  /**
   * Git on a run's worktree, with its admin dir named on the command line. An agent edits files in
   * the worktree, so git never discovers its dir or config through `<worktree>/.git`: that file
   * must be a plain file pointing into a mirror's `worktrees/` folder, and `core.fsmonitor` (a
   * command git would run) is off.
   */
  async #worktreeGit(worktree: string): Promise<(args: string[]) => Promise<string>> {
    const dir = path.resolve(worktree);
    if (path.dirname(dir) !== path.join(this.rootDir, 'worktrees')) {
      throw new TypeError(`Not a run worktree: ${JSON.stringify(worktree)}`);
    }
    const dotGit = path.join(dir, '.git');
    if (!(await lstat(dotGit)).isFile()) throw new Error(`Not a git worktree: ${dir}`);
    const pointer = /^gitdir: (.+)$/m.exec(await readFile(dotGit, 'utf8'))?.[1]?.trim();
    const gitDir = pointer ? await realpath(path.resolve(dir, pointer)).catch(() => null) : null;
    const mirrors = await realpath(path.join(this.rootDir, 'mirrors')).catch(() => null);
    const relative = gitDir && mirrors ? path.relative(mirrors, gitDir).split(path.sep) : [];
    // <mirrors>/<owner>/<repo>.git/worktrees/<name>
    if (relative.length !== 4 || relative.includes('..') || relative[2] !== 'worktrees') {
      throw new Error(`The worktree's .git does not point into a mirror: ${dir}`);
    }
    const fixed = ['--git-dir', gitDir!, '--work-tree', dir, '-c', 'core.fsmonitor=false'];
    return (args) => this.#git(undefined, [...fixed, ...args]);
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

  async #git(
    gitDir: string | undefined,
    args: string[],
    token?: string,
    env: Record<string, string> = {},
  ): Promise<string> {
    const fullArgs = gitDir ? ['-C', gitDir, ...args] : args;
    const { stdout } = await this.#exec('git', fullArgs, {
      env: { ...gitAuthEnv(token), ...env },
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

/**
 * Writes or deletes one patch file, refusing a path that leaves the worktree. The worktree holds
 * the PR's code, so a folder on the way may be a symbolic link out of it: the write refuses to
 * pass through one, and a link at the file itself is replaced, never followed.
 */
async function writeWorktreeFile(
  worktree: string,
  file: string,
  content: Uint8Array | string | null,
): Promise<void> {
  const target = path.resolve(worktree, file);
  if (path.isAbsolute(file) || !target.startsWith(worktree + path.sep)) {
    throw new TypeError(`Not a path inside the repository: ${JSON.stringify(file)}`);
  }
  const folders = path.relative(worktree, path.dirname(target)).split(path.sep).filter(Boolean);
  let dir = worktree;
  for (const folder of folders) {
    dir = path.join(dir, folder);
    const stat = await lstat(dir).catch(() => null);
    if (!stat) break;
    if (!stat.isDirectory()) {
      throw new TypeError(`Not a path inside the repository: ${JSON.stringify(file)}`);
    }
  }
  // rm on a link removes the link only.
  await rm(target, { force: true });
  if (content === null) return;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, { flag: 'wx' });
}

/**
 * Why git refused the update, if it did: `head_moved` when the branch moved (non-fast-forward or
 * fetch first); `remote_rejected` when the remote declined it (a protected branch, a ruleset that
 * asks for signed commits, a pre-receive hook). A retry would be declined again.
 */
function rejectionOf(error: unknown): 'head_moved' | 'remote_rejected' | null {
  const output = error as { stdout?: unknown; stderr?: unknown };
  const text = `${String(output.stdout ?? '')}\n${String(output.stderr ?? '')}`;
  if (/\[rejected\]|\(non-fast-forward\)|\(fetch first\)/.test(text)) return 'head_moved';
  if (/\[remote rejected\]/.test(text)) return 'remote_rejected';
  return null;
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
