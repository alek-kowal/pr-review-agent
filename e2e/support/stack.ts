// The e2e test stack (S-01-T15): api and worker in one process on test doubles: its own
// database, `FakeGitHubGateway`, a reviewer and an analyst scripted per PR number, a local blob
// store and a `CliGitMirror` on a local fixture repository. Playwright starts it (`webServer`) and
// stops it with SIGTERM; the specs read `STATE_FILE`.
import {
  NO_USAGE,
  TEAM_ANSWERS_TITLE,
  type AgentRunInput,
  type AgentRunner,
  type AgentRunResult,
  type Analyst,
  type AnalystInput,
  type AnalystOutput,
} from '@pra/agents';
import { FakeAgentRunner, FakeAnalyst, FakeJudge } from '@pra/agents/testing';
import {
  closeDb,
  createDb,
  createQueue,
  getAlertConfig,
  getAppSettings,
  getPullRequest,
  getRepositoryByFullName,
  importInstructionV1,
  upsertRepository,
  writeAlertConfig,
  writeAppSettings,
  type Db,
} from '@pra/db';
import type {
  CiStatus,
  CommitComparison,
  GitExec,
  GitHubPullRequest,
  PullRequestFreshState,
  Sandbox,
} from '@pra/integrations';
import { createTestDatabase } from '@pra/db/testing';
import { CliGitMirror, LocalBlobStore } from '@pra/integrations';
import { createLogger } from '@pra/integrations/logging';
import {
  createGitFixture,
  DEFAULT_FEATURE_FILES,
  FakeClickUpGateway,
  FakeGitHubGateway,
  FakeSandbox,
  isolatedGitExec,
} from '@pra/integrations/testing';
import { randomBytes } from 'node:crypto';
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildServer } from '../../apps/api/src/server.ts';
import { startWorker } from '../../apps/worker/src/worker.ts';
import {
  analystHoldFile,
  analystInputFile,
  API_PORT,
  API_URL,
  AUTOFIX_FINDINGS,
  AUTOFIX_PRS,
  AUTOFIX_REPOSITORY,
  briefFile,
  CLICKUP_REPOSITORY,
  CLICKUP_TASKS,
  commentsFile,
  FAIL_ONCE_PRS,
  USAGE_LIMIT_PRS,
  USAGE_LIMIT_RESET_MS,
  COSTLY_RETRY_PRS,
  COSTLY_RETRY_USD,
  FAILING_PR_FROM,
  FIXTURE_CI,
  GENERAL_ALERTS_TASK,
  GLOBAL_LEVEL_REPOSITORY,
  HELD_PRS,
  IMPLEMENTER_HOLD,
  IMPLEMENTER_REPOSITORY,
  LARGE_PR_REPOSITORY,
  HELD_TURN_COST_USD,
  LEARNING_COMMENTS,
  LEARNING_LESSONS,
  LEARNING_PRS,
  LEARNING_REPOSITORY,
  lessonsFile,
  LEVEL_TWO_REPOSITORY,
  MERGE_REFUSAL,
  MERGE_REPOSITORY,
  movedHeadFile,
  NOTIFY_REPOSITORY,
  PUSH_PRS,
  PUSH_REPOSITORY,
  PUSH_SIGNER,
  pushBranch,
  QUESTION_PRS,
  README_REPOSITORY,
  REFUSED_MERGE_PRS,
  releaseFile,
  SECOND_REPOSITORY,
  SENSITIVE_REPOSITORY,
  SHADOW_REPOSITORY,
  STATE_FILE,
  TRIAL_PRS,
  TRIAL_RULE_FINDING,
  trialRule,
  VERIFIED_REPOSITORY,
  WEB_URL,
  type StackState,
} from './env.ts';
import { seedInsightsHistory } from './insights-seed.ts';

const FULL_NAME = 'synergycodes/workflowbuilder';
const INSTALLATION_ID = 55500001;

/** What the reviewer answers for a PR that does not fail: 2 Blocking, 1 Worth fixing, 1 Nit. */
export const SCRIPTED_REVIEW = {
  summary: 'Adds inline renaming of edge labels.',
  risk: 'medium',
  findings: [
    {
      title: 'Empty label hides the edge',
      severity: 'blocker',
      file: 'apps/demo/src/edges.ts',
      line: 1,
      scenario: 'When a label is only spaces, trim() leaves nothing and the edge shows no text.',
      suggestion: 'Fall back to the edge id when the trimmed label is empty.',
    },
    {
      title: 'Renaming drops the undo history',
      severity: 'blocker',
      file: 'packages/sdk/src/index.ts',
      line: 1,
      scenario: 'After renaming a label, Undo restores the whole diagram instead of the label.',
      suggestion: 'Record the rename as one history step.',
    },
    {
      title: 'SDK entry exports an internal type',
      severity: 'should',
      file: 'packages/sdk/src/index.ts',
      line: 2,
      scenario: 'Consumers start depending on EdgeLabel, which is meant to be internal.',
      suggestion: 'Export EdgeLabel from a separate internal entry.',
    },
    {
      title: 'Rename helper name is vague',
      severity: 'nit',
      file: 'apps/demo/src/edges.ts',
      line: 2,
      scenario: 'Readers cannot tell that rename only changes the label.',
      suggestion: 'Call it renameLabel.',
    },
  ],
  questions: [],
  notChecked: ['Keyboard focus after renaming'],
};

/** The questions of a PR in `QUESTION_PRS` before the team answered them. */
const SCRIPTED_QUESTIONS = [
  {
    question: 'Should an empty label fall back to the edge id?',
    options: ['Yes, show the edge id', 'No, hide the label'],
    recommended: 0,
    why: 'The diff trims the label but does not say what an empty one shows.',
  },
  {
    question: 'Is EdgeLabel part of the public SDK?',
    options: ['Yes, keep it exported', 'No, it is internal', 'Not decided yet'],
    recommended: 1,
    why: 'The SDK entry now exports it, which makes it public API.',
  },
];

/** The finding a PR in `QUESTION_PRS` gets once the team answered (a new result of round 2). */
const ANSWERED_FINDING = {
  title: 'Long labels overflow the edge',
  severity: 'should',
  file: 'apps/demo/src/edges.ts',
  line: 1,
  scenario: 'A label of 200 characters runs past both nodes and covers other edges.',
  suggestion: 'Truncate the label with an ellipsis and show the full text on hover.',
};

/** What the reviewer answers a PR in `QUESTION_PRS`, given whether the brief has answers. */
const questionsReview = (answered: boolean) =>
  answered
    ? { ...SCRIPTED_REVIEW, findings: [...SCRIPTED_REVIEW.findings, ANSWERED_FINDING] }
    : { ...SCRIPTED_REVIEW, questions: SCRIPTED_QUESTIONS };

/** A reproduction's last line says how it ends; the sandbox double exits with that code. */
const reproduction = (exitCode: number) => `console.log('repro');\nprocess.exit(${exitCode});\n`;

/**
 * What the verifier answers per finding title (verified-findings.spec.ts): the first Blocking is
 * Confirmed by a reproduction (exit 0), the second Refuted by one (exit 3), the Worth fixing one
 * stays Not proven after a broken script and its repair (exit 1 twice), the rest without proof.
 */
const VERIFIER_ANSWERS: Record<string, { script?: string; quote?: string }> = {
  'Empty label hides the edge': {
    quote: 'export const label = (edge: { name: string }) => edge.name.trim();',
    script: reproduction(0),
  },
  'Renaming drops the undo history': { script: reproduction(3) },
  'SDK entry exports an internal type': {
    quote: "export * from './edges.ts';",
    script: reproduction(1),
  },
  // autofix.spec.ts: confirmed by a reproduction.
  [AUTOFIX_FINDINGS.sensitive.title]: {
    quote: 'export const store = new Map<string, string>();',
    script: reproduction(0),
  },
};

async function verifierAnswer(cwd: string) {
  const finding = JSON.parse(await readFile(path.join(cwd, 'finding.json'), 'utf8')) as {
    title: string;
    file: string;
  };
  const answer = VERIFIER_ANSWERS[finding.title] ?? {};
  return {
    verdict: 'confirmed',
    reason: `Checked ${finding.file} at the reviewed commit.`,
    evidence: answer.quote ? [{ file: finding.file, line: 1, quote: answer.quote }] : [],
    ...(answer.script ? { script: answer.script } : {}),
    remedy: { kind: 'obvious', why: 'One clear fix.' },
  };
}

/**
 * Whether a reproduction's worktree carries the implementer double's fix: tracked files differ
 * from the checkout (a patch), or the checked-out commit holds its `// Fixed:` lines (a pushed
 * patch, push-recheck.spec.ts).
 */
async function patched(dir: string): Promise<boolean> {
  const git = (args: string[]) =>
    isolatedGitExec('git', args, { cwd: dir, env: {}, timeout: 10_000 });
  const status = await git(['status', '--porcelain', '--untracked-files=no']);
  if (status.stdout.trim() !== '') return true;
  // `git grep` exits 1 when nothing matches.
  return git(['grep', '--quiet', '--fixed-strings', '// Fixed: ', 'HEAD']).then(
    () => true,
    () => false,
  );
}

/**
 * A Checks install step (`sh -c ...`, checks-change-type.spec.ts) succeeds; a reproduction exits
 * with the code its script ends with (see `reproduction`), except on a patched worktree (the
 * implementer's, implement-patch.spec.ts), where the bug no longer happens (exit 3).
 */
const sandbox = new FakeSandbox(async (spec) => {
  if (spec.command[0] === 'sh')
    return { exitCode: 0, output: 'installed', outputTail: 'installed' };
  const [mount] = spec.mounts;
  const script = spec.command[1];
  if (!mount || !script) return { exitCode: 1, output: 'no script' };
  const source = await readFile(path.join(mount.hostPath, path.basename(script)), 'utf8');
  const exitCode = (await patched(mount.hostPath))
    ? 3
    : Number(/process\.exit\((\d+)\)/.exec(source)?.[1] ?? 1);
  const output = exitCode === 0 ? 'label: ""\nbug reproduced' : `repro exited with ${exitCode}`;
  return { exitCode, output, outputTail: output };
});

/**
 * The sandbox double, logging each call to `log` as a JSON line `{ command, mounts }` (the host
 * paths; a run's worktree ends in `run-<id>`), so a spec can count a run's calls (fork-pr.spec.ts).
 */
const loggedSandbox = (log: string): Sandbox => ({
  async run(spec) {
    const mounts = spec.mounts.map((mount) => mount.hostPath);
    await appendFile(log, `${JSON.stringify({ command: spec.command, mounts })}\n`);
    return sandbox.run(spec);
  },
});

/**
 * The scripted review of PR `number`. In `TRIAL_PRS`, when the `review-rules.md` the reviewer
 * reads holds `trialRule(number)`, the Nit gives way to `TRIAL_RULE_FINDING` (instructions.spec.ts).
 */
async function scriptedReview(number: number, readDirs: readonly string[] = []) {
  // autofix.spec.ts: one Blocking finding with an obvious fix, so nothing holds level 5.
  if (inRange(number, AUTOFIX_PRS.fixes) || inRange(number, AUTOFIX_PRS.shadow)) {
    return { ...SCRIPTED_REVIEW, findings: [AUTOFIX_FINDINGS.fixes] };
  }
  if (inRange(number, AUTOFIX_PRS.sensitive)) {
    return { ...SCRIPTED_REVIEW, findings: [AUTOFIX_FINDINGS.sensitive] };
  }
  if (number < TRIAL_PRS.from || number > TRIAL_PRS.to) return SCRIPTED_REVIEW;
  for (const dir of readDirs) {
    const rules = await readFile(path.join(dir, 'review-rules.md'), 'utf8').catch(() => '');
    if (rules.includes(trialRule(number))) {
      return {
        ...SCRIPTED_REVIEW,
        findings: [
          ...SCRIPTED_REVIEW.findings.filter((f) => f.severity !== 'nit'),
          TRIAL_RULE_FINDING,
        ],
      };
    }
  }
  return SCRIPTED_REVIEW;
}

/**
 * Waits until `file` exists, at most `ms` (a held reviewer never blocks the stack for good), or
 * until the session is aborted (a cancel).
 */
async function waitForFile(file: string, ms: number, signal?: AbortSignal): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until && !signal?.aborted) {
    if (
      await access(file).then(
        () => true,
        () => false,
      )
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Waits while `file` exists, or until the session is aborted (a cancel). */
async function whileExists(file: string, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted && (await stat(file).catch(() => null))) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The first `name` in `dirs`, or null. */
async function readFirst(dirs: readonly string[], name: string): Promise<string | null> {
  for (const dir of dirs) {
    const text = await readFile(path.join(dir, name), 'utf8').catch(() => null);
    if (text !== null) return text;
  }
  return null;
}

/** The reviewer of a fix check at this head leaves the first finding unresolved (chains.spec.ts). */
const FIX_NOT_RESOLVED_AT = 1;

/**
 * Answers per session kind. A full review keeps its brief (`briefFile`) and the `lessons.md` it
 * reads (`lessonsFile`), and reads the PR number from the brief: from `FAILING_PR_FROM`, invalid;
 * in `FAIL_ONCE_PRS`, invalid the first time only; in `USAGE_LIMIT_PRS`, the Claude usage limit
 * the first time only; in `HELD_PRS`, one reported turn, then the
 * review once the spec releases it or cancels the run; in `QUESTION_PRS`, questions until the
 * brief has the team's answers; while `hold-<number>` exists in `holdDir` it waits. A fix check
 * (no brief, `findings.json`) resolves every finding, except at `fixShas[FIX_NOT_RESOLVED_AT]`,
 * where the first stays unresolved. The verifier answers per finding title.
 */
class ScriptedAgents implements AgentRunner {
  readonly #holdDir: string;
  readonly #fixShas: readonly string[];
  readonly #callLog: string;
  readonly #failedOnce = new Set<number>();
  readonly #usageLimited = new Set<number>();
  /** Full reviews per PR number so far. */
  readonly #reviews = new Map<number, number>();

  constructor(holdDir: string, fixShas: readonly string[], callLog: string) {
    this.#holdDir = holdDir;
    this.#fixShas = fixShas;
    this.#callLog = callLog;
  }

  async run<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    // The model each double received (models-levels-audit.spec.ts).
    await appendFile(
      this.#callLog,
      `${JSON.stringify({ role: input.role, model: input.model, dirs: [input.cwd, ...(input.readDirs ?? [])] })}\n`,
    );
    if (input.role === 'verifier') {
      const output = await verifierAnswer(input.cwd);
      return new FakeAgentRunner([{ output, costUsd: 0.05, turns: 3 }]).run(input);
    }
    if (input.role === 'implementer') return this.#implement(input);
    const brief = await readFile(path.join(input.cwd, 'brief.md'), 'utf8').catch(() => null);
    if (brief === null) return this.#checkFixes(input);

    const number = Number(/PR #(\d+)/.exec(brief)?.[1]);
    const k = (this.#reviews.get(number) ?? 0) + 1;
    this.#reviews.set(number, k);
    await writeFile(briefFile(this.#holdDir, number, k), brief);
    const lessons = await readFirst(input.readDirs ?? [], 'lessons.md');
    if (lessons !== null) await writeFile(lessonsFile(this.#holdDir, number, k), lessons);
    const held = number >= HELD_PRS.from && number <= HELD_PRS.to;
    if (held) {
      input.onProgress?.({ turns: 1, costUsd: HELD_TURN_COST_USD, usage: NO_USAGE });
      await waitForFile(releaseFile(number), 120_000, input.signal);
    }
    await this.#whileHeld(number, input.signal);
    // A cancelled session ends with what it spent so far, as the real adapter does.
    if (input.signal?.aborted) {
      const spent = held ? { costUsd: HELD_TURN_COST_USD, turns: 1 } : { turns: 0 };
      return new FakeAgentRunner([{ fail: 'cancelled', ...spent }]).run(input);
    }
    if (inRange(number, USAGE_LIMIT_PRS) && !this.#usageLimited.has(number)) {
      this.#usageLimited.add(number);
      const resetsAt = new Date(Date.now() + USAGE_LIMIT_RESET_MS).toISOString();
      const limit = { fail: 'usage_limit_reached' as const, params: { resetsAt }, costUsd: 0.02 };
      return new FakeAgentRunner([limit]).run(input);
    }
    const costly = number >= COSTLY_RETRY_PRS.from && number <= COSTLY_RETRY_PRS.to;
    const failOnce =
      ((number >= FAIL_ONCE_PRS.from && number <= FAIL_ONCE_PRS.to) || costly) &&
      !this.#failedOnce.has(number);
    if (failOnce) this.#failedOnce.add(number);
    const output =
      number >= QUESTION_PRS.from && number <= QUESTION_PRS.to
        ? questionsReview(brief.includes(TEAM_ANSWERS_TITLE))
        : await scriptedReview(number, input.readDirs);
    const step =
      number >= FAILING_PR_FROM || failOnce
        ? { output: { summary: 'not a review' }, costUsd: 0.04 }
        : { output, costUsd: costly ? COSTLY_RETRY_USD : 0.31, turns: 6 };
    return new FakeAgentRunner([step]).run(input);
  }

  async #checkFixes<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    const findings = JSON.parse(await readFile(path.join(input.cwd, 'findings.json'), 'utf8')) as {
      id: number;
    }[];
    const missAt = this.#fixShas[FIX_NOT_RESOLVED_AT];
    const missOne = missAt !== undefined && input.prompt.includes(`new head ${missAt}`);
    const fixes = findings.map(({ id }, i) => ({
      findingId: id,
      resolved: !(missOne && i === 0),
      reason: missOne && i === 0 ? 'The fix misses the empty case.' : 'The fix handles it.',
    }));
    return new FakeAgentRunner([{ output: { fixes }, costUsd: 0.12 }]).run(input);
  }

  /**
   * Appends a fix line per finding to the finding's file in the worktree and claims every finding
   * fixed; a revise note lands in the first file. While `IMPLEMENTER_HOLD` exists in the hold
   * folder it waits, and a cancel ends the session with no answer (implement-patch.spec.ts).
   */
  async #implement<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    const dir = input.readDirs?.[0] ?? '';
    const findings = JSON.parse(await readFile(path.join(dir, 'findings.json'), 'utf8')) as {
      id: string | number;
      title: string;
      file: string;
    }[];
    const note = await readFile(path.join(dir, 'revise-note.md'), 'utf8').catch(() => null);
    // push-recheck.spec.ts runs beside implement-patch.spec.ts: its repository's sessions (the
    // worktree's remote is the push remote) never wait on the hold.
    const remote = await isolatedGitExec('git', ['config', '--get', 'remote.origin.url'], {
      cwd: input.cwd,
      env: {},
      timeout: 10_000,
    }).then(
      (result) => result.stdout.trim(),
      () => '',
    );
    if (remote !== pushRemote) {
      await whileExists(path.join(this.#holdDir, IMPLEMENTER_HOLD), input.signal);
    }
    if (input.signal?.aborted) {
      return new FakeAgentRunner([{ fail: 'cancelled', turns: 0 }]).run(input);
    }
    for (const [i, finding] of findings.entries()) {
      const file = path.join(input.cwd, finding.file);
      await mkdir(path.dirname(file), { recursive: true });
      const before = await readFile(file, 'utf8').catch(() => '');
      const revised = i === 0 && note ? `// Revised: ${note.trim()}\n` : '';
      await writeFile(file, `${before}// Fixed: ${finding.title}\n${revised}`);
    }
    const output = {
      decisions: findings.map((f) => ({ id: String(f.id), action: 'fixed', why: 'Fixed it.' })),
      commitMessage: 'Fix the review findings',
      summary: `Fixed ${findings.length} findings.`,
      notChecked: [],
    };
    return new FakeAgentRunner([{ output, costUsd: 0.2, turns: 4 }]).run(input);
  }

  async #whileHeld(number: number, signal?: AbortSignal): Promise<void> {
    await whileExists(path.join(this.#holdDir, `hold-${number}`), signal);
  }
}

const inRange = (number: number, range: { from: number; to: number }) =>
  number >= range.from && number <= range.to;

/**
 * The analyst double (learning.spec.ts): keeps its input as JSON (`analystInputFile`), waits while
 * `analystHoldFile` exists, then proposes the lesson of the PR's range in `LEARNING_PRS`, or none.
 */
class ScriptedAnalyst implements Analyst {
  readonly #holdDir: string;

  constructor(holdDir: string) {
    this.#holdDir = holdDir;
  }

  async analyse(input: AnalystInput): Promise<AgentRunResult<AnalystOutput>> {
    const { signal, ...kept } = input;
    const { number } = input.pr;
    await writeFile(analystInputFile(this.#holdDir, number), JSON.stringify(kept, null, 2));
    await whileExists(analystHoldFile(this.#holdDir, number), signal);
    if (signal?.aborted) return new FakeAnalyst([{ fail: 'cancelled' }]).analyse(input);
    const lesson =
      inRange(number, LEARNING_PRS.snapshot) || inRange(number, LEARNING_PRS.merged)
        ? LEARNING_LESSONS.snapshot
        : inRange(number, LEARNING_PRS.source)
          ? LEARNING_LESSONS.source
          : null;
    const candidates = lesson
      ? [{ ...lesson, evidence: `Seen on #${number}.`, duplicateOf: null }]
      : [];
    return new FakeAnalyst([{ candidates }]).analyse(input);
  }
}

/** The repositories whose remote is the push remote (push-recheck.spec.ts, autofix.spec.ts). */
const PUSHED_TO = new Set([PUSH_REPOSITORY.fullName, AUTOFIX_REPOSITORY.fullName]);

/**
 * The GitHub double, plus fresh PR state for PRs the specs only delivered as webhooks: GitHub
 * would answer what those webhooks said, which is the stored row (merge.spec.ts, and the
 * implementer's fresh fork check in implement-patch.spec.ts).
 */
class StackGitHub extends FakeGitHubGateway {
  readonly #db: Db;
  readonly #pushRemote: string;

  constructor(
    db: Db,
    pushRemote: string,
    options: ConstructorParameters<typeof FakeGitHubGateway>[0],
  ) {
    super(options);
    this.#db = db;
    this.#pushRemote = pushRemote;
  }

  /** The push remote's commits are real: GitHub compares them with git in it. */
  override async compareCommits(
    fullName: string,
    base: string,
    head: string,
  ): Promise<CommitComparison> {
    if (!PUSHED_TO.has(fullName)) return super.compareCommits(fullName, base, head);
    const counted = await isolatedGitExec(
      'git',
      ['rev-list', '--left-right', '--count', `${base}...${head}`],
      { cwd: this.#pushRemote, env: {}, timeout: 10_000 },
    ).catch(() => null);
    if (!counted) return super.compareCommits(fullName, base, head);
    const [behindBy = 0, aheadBy = 0] = counted.stdout.trim().split(/\s+/).map(Number);
    this.setComparison(fullName, base, head, aheadBy, behindBy);
    return super.compareCommits(fullName, base, head);
  }

  /** CI in the push remote's repositories is green at every commit, the pushed ones too. */
  override async getCiStatus(fullName: string, sha: string): Promise<CiStatus> {
    if (PUSHED_TO.has(fullName)) {
      this.setCiChecks(fullName, sha, [{ name: 'build', source: 'check_run', state: 'passed' }]);
    }
    return super.getCiStatus(fullName, sha);
  }

  override async getPullRequest(fullName: string, number: number): Promise<GitHubPullRequest> {
    if (this.pullRequests.has(`${fullName}#${number}`)) {
      return super.getPullRequest(fullName, number);
    }
    const repository = await getRepositoryByFullName(this.#db, fullName);
    const pr = repository && (await getPullRequest(this.#db, repository.id, number));
    if (!pr) return super.getPullRequest(fullName, number);
    const iso = (date: Date | null) => date?.toISOString() ?? null;
    return {
      fullName,
      number,
      title: pr.title,
      body: pr.body ?? '',
      authorLogin: pr.authorLogin,
      htmlUrl: `https://github.com/${fullName}/pull/${number}`,
      headSha: pr.headSha,
      headRef: pr.headRef,
      headRepoFullName: pr.isFork ? `fork-owner/${fullName.split('/')[1]}` : fullName,
      baseSha: pr.baseSha,
      baseRef: pr.baseRef,
      isDraft: pr.isDraft,
      isFork: pr.isFork,
      state: pr.state,
      commitsCount: pr.commitsCount,
      openedAt: pr.openedAt.toISOString(),
      updatedAt: pr.updatedAt.toISOString(),
      closedAt: iso(pr.closedAt),
      mergedAt: iso(pr.mergedAt),
      mergeSha: pr.mergeSha,
    };
  }

  override async getPullRequestState(
    fullName: string,
    number: number,
  ): Promise<PullRequestFreshState> {
    if (this.pullRequests.has(`${fullName}#${number}`)) {
      return super.getPullRequestState(fullName, number);
    }
    const repository = await getRepositoryByFullName(this.#db, fullName);
    const pr = repository && (await getPullRequest(this.#db, repository.id, number));
    if (!pr) return super.getPullRequestState(fullName, number);
    const moved =
      fullName === PUSH_REPOSITORY.fullName
        ? await readFile(movedHeadFile(holdDir, number), 'utf8').catch(() => null)
        : null;
    return {
      headSha: moved?.trim() || pr.headSha,
      state: pr.state,
      mergeableState: pr.state === 'open' ? 'clean' : 'unknown',
    };
  }
}

const logger = createLogger('e2e', { LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn' });
const root = await mkdtemp(path.join(tmpdir(), 'pra-e2e-'));
const holdDir = path.join(root, 'hold');
await mkdir(holdDir);
const agentCalls = path.join(root, 'agent-calls.jsonl');
const sandboxCalls = path.join(root, 'sandbox-calls.jsonl');
// The feature branch also adds a migration: a sensitive file for a repository whose settings say
// so (connect-repo.spec.ts), an ordinary file for the others. Three pushes follow the reviewed
// head (chains.spec.ts).
const [database, fixture] = await Promise.all([
  createTestDatabase(),
  createGitFixture({
    feature: {
      ...DEFAULT_FEATURE_FILES,
      'db/migrations/0001_edge_labels.sql': 'alter table edges add column label text;\n',
    },
    fixes: [
      {
        'apps/demo/src/edges.ts':
          'export const label = (edge: { name: string; id: string }) =>\n' +
          '  edge.name.trim() || edge.id;\n',
      },
      { 'packages/sdk/src/history.ts': 'export const renameStep = (name: string) => name;\n' },
      { 'packages/sdk/src/history.ts': 'export const renameStep = (to: string) => ({ to });\n' },
    ],
  }),
]);
// push-recheck.spec.ts and autofix.spec.ts: a bare copy of the fixture that accepts pushes, one
// branch per PR.
const pushRemote = path.join(root, 'push-remote.git');
const gitPushes = path.join(root, 'git-pushes.jsonl');
const inRoot = { cwd: root, env: {}, timeout: 30_000 };
await isolatedGitExec('git', ['clone', '--quiet', '--bare', fixture.dir, pushRemote], inRoot);
const pushedPrs = [PUSH_PRS, AUTOFIX_PRS.fixes, AUTOFIX_PRS.sensitive].flatMap(({ from, to }) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i),
);
for (const number of pushedPrs) {
  await isolatedGitExec(
    'git',
    ['-C', pushRemote, 'update-ref', `refs/heads/${pushBranch(number)}`, fixture.headSha],
    inRoot,
  );
}
/** The worker's git, logging the argv of each push for the specs. */
const loggedGit: GitExec = async (file, args, options) => {
  if (args.includes('push')) await appendFile(gitPushes, `${JSON.stringify({ args })}\n`);
  return isolatedGitExec(file, args, options);
};

const db = createDb(database.url, { max: 5 });
const queue = createQueue(database.url, { max: 5 });
const webhookSecret = randomBytes(16).toString('hex');
const github = new StackGitHub(db, pushRemote, {
  webhookSecret,
  installations: {
    [MERGE_REPOSITORY.fullName]: MERGE_REPOSITORY.installationId,
    [NOTIFY_REPOSITORY.fullName]: NOTIFY_REPOSITORY.installationId,
    [FULL_NAME]: INSTALLATION_ID,
    // Reachable but not connected: Settings → Repositories connects it (connect-repo.spec.ts).
    [SECOND_REPOSITORY.fullName]: SECOND_REPOSITORY.installationId,
    [VERIFIED_REPOSITORY.fullName]: VERIFIED_REPOSITORY.installationId,
    [IMPLEMENTER_REPOSITORY.fullName]: IMPLEMENTER_REPOSITORY.installationId,
    [LEVEL_TWO_REPOSITORY.fullName]: LEVEL_TWO_REPOSITORY.installationId,
    [LARGE_PR_REPOSITORY.fullName]: LARGE_PR_REPOSITORY.installationId,
    [SENSITIVE_REPOSITORY.fullName]: SENSITIVE_REPOSITORY.installationId,
    [GLOBAL_LEVEL_REPOSITORY.fullName]: GLOBAL_LEVEL_REPOSITORY.installationId,
    [CLICKUP_REPOSITORY.fullName]: CLICKUP_REPOSITORY.installationId,
    [LEARNING_REPOSITORY.fullName]: LEARNING_REPOSITORY.installationId,
    [README_REPOSITORY.fullName]: README_REPOSITORY.installationId,
    [PUSH_REPOSITORY.fullName]: PUSH_REPOSITORY.installationId,
    [AUTOFIX_REPOSITORY.fullName]: AUTOFIX_REPOSITORY.installationId,
    [SHADOW_REPOSITORY.fullName]: SHADOW_REPOSITORY.installationId,
  },
});
github.addUser(PUSH_SIGNER.login, PUSH_SIGNER.id);
// GitHub's compare on the branch's commits, as the worker measures commits since a review.
const branch = [fixture.headSha, ...fixture.fixShas];
for (const [i, base] of branch.entries()) {
  for (const [j, head] of branch.entries()) {
    if (j <= i) continue;
    for (const fullName of [
      FULL_NAME,
      SENSITIVE_REPOSITORY.fullName,
      MERGE_REPOSITORY.fullName,
      LEARNING_REPOSITORY.fullName,
    ]) {
      github.setComparison(fullName, base, head, j - i);
    }
  }
}
// merge.spec.ts and learning.spec.ts: CI green at the fixture head, and GitHub refusing the PRs in
// merge.spec.ts's refused range.
for (const fullName of [MERGE_REPOSITORY.fullName, LEARNING_REPOSITORY.fullName]) {
  github.setCiChecks(fullName, fixture.headSha, [
    { name: 'build', source: 'check_run', state: 'passed' },
    { name: 'e2e', source: 'check_run', state: 'passed' },
  ]);
}
for (let number = REFUSED_MERGE_PRS.from; number <= REFUSED_MERGE_PRS.to; number++) {
  github.refuseMerge(MERGE_REPOSITORY.fullName, number, MERGE_REFUSAL);
}
const blobStore = new LocalBlobStore(path.join(root, 'blobs'));

const repository = await upsertRepository(db, {
  slug: 'workflowbuilder',
  githubFullName: FULL_NAME,
  defaultLevel: 1,
});
await importInstructionV1(db, {
  scope: 'global',
  fileKey: 'review-rules.md',
  content: '# Review rules\n\nReport real problems only.\n',
});
// verified-findings.spec.ts: one repository per level, so WB stays at level 1 for the others.
await upsertRepository(
  db,
  {
    slug: VERIFIED_REPOSITORY.slug,
    githubFullName: VERIFIED_REPOSITORY.fullName,
    defaultLevel: 3,
    sensitivePatterns: [{ pattern: 'db/migrations/**', reason: 'Migrations cannot be undone.' }],
  },
  { installationId: VERIFIED_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  { slug: PUSH_REPOSITORY.slug, githubFullName: PUSH_REPOSITORY.fullName, defaultLevel: 4 },
  { installationId: PUSH_REPOSITORY.installationId },
);
// autofix.spec.ts: level 5 acts by itself, level 3 only writes the shadow log.
await upsertRepository(
  db,
  {
    slug: AUTOFIX_REPOSITORY.slug,
    githubFullName: AUTOFIX_REPOSITORY.fullName,
    defaultLevel: 5,
    sensitivePatterns: AUTOFIX_REPOSITORY.patterns,
  },
  { installationId: AUTOFIX_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  { slug: SHADOW_REPOSITORY.slug, githubFullName: SHADOW_REPOSITORY.fullName, defaultLevel: 3 },
  { installationId: SHADOW_REPOSITORY.installationId },
);
// implement-patch.spec.ts: level 3 without sensitive files, raised to level 4 per PR.
await upsertRepository(
  db,
  {
    slug: IMPLEMENTER_REPOSITORY.slug,
    githubFullName: IMPLEMENTER_REPOSITORY.fullName,
    defaultLevel: 3,
  },
  { installationId: IMPLEMENTER_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  {
    slug: LEVEL_TWO_REPOSITORY.slug,
    githubFullName: LEVEL_TWO_REPOSITORY.fullName,
    defaultLevel: 2,
    fetchCommand: 'pnpm fetch',
    installCommand: 'pnpm install --offline',
  },
  { installationId: LEVEL_TWO_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  {
    slug: LARGE_PR_REPOSITORY.slug,
    githubFullName: LARGE_PR_REPOSITORY.fullName,
    defaultLevel: 2,
    largePrLines: 1,
  },
  { installationId: LARGE_PR_REPOSITORY.installationId },
);
for (const fullName of [LEVEL_TWO_REPOSITORY.fullName, LARGE_PR_REPOSITORY.fullName]) {
  github.setCiChecks(fullName, fixture.headSha, [...FIXTURE_CI]);
}
await upsertRepository(
  db,
  {
    slug: SENSITIVE_REPOSITORY.slug,
    githubFullName: SENSITIVE_REPOSITORY.fullName,
    defaultLevel: 1,
    sensitivePatterns: SENSITIVE_REPOSITORY.patterns,
  },
  { installationId: SENSITIVE_REPOSITORY.installationId },
);
// No level of its own: rounds start at the global default (models-levels-audit.spec.ts).
await upsertRepository(
  db,
  { slug: GLOBAL_LEVEL_REPOSITORY.slug, githubFullName: GLOBAL_LEVEL_REPOSITORY.fullName },
  { installationId: GLOBAL_LEVEL_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  { slug: MERGE_REPOSITORY.slug, githubFullName: MERGE_REPOSITORY.fullName, defaultLevel: 1 },
  { installationId: MERGE_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  {
    slug: CLICKUP_REPOSITORY.slug,
    githubFullName: CLICKUP_REPOSITORY.fullName,
    defaultLevel: 2,
    clickup: CLICKUP_REPOSITORY.clickup,
  },
  { installationId: CLICKUP_REPOSITORY.installationId },
);
await upsertRepository(
  db,
  {
    slug: NOTIFY_REPOSITORY.slug,
    githubFullName: NOTIFY_REPOSITORY.fullName,
    defaultLevel: 1,
    clickup: {
      workspaceId: '9012',
      spaceId: null,
      followUpListId: null,
      taskIdPattern: 'WB-\\d+',
    },
  },
  { installationId: NOTIFY_REPOSITORY.installationId },
);
// README screenshots (e2e/readme/shots.readme.ts): level 3, so findings carry verdicts, and green CI.
await upsertRepository(
  db,
  { slug: README_REPOSITORY.slug, githubFullName: README_REPOSITORY.fullName, defaultLevel: 3 },
  { installationId: README_REPOSITORY.installationId },
);
github.setCiChecks(README_REPOSITORY.fullName, fixture.headSha, [
  { name: 'build', source: 'check_run', state: 'passed' },
  { name: 'lint', source: 'check_run', state: 'passed' },
  { name: 'e2e', source: 'check_run', state: 'passed' },
]);
for (const [fileKey, content] of [
  ['prompt-verifier.md', 'Verify the finding in finding.json. Rules: {{knowledgeDir}}.\n'],
  ['verify-rules.md', '# Verify rules\n\nQuote the code word for word.\n'],
  [
    'prompt-implementer.md',
    'Fix the findings in {{runDir}}/findings.json. Rules: {{knowledgeDir}}.\n',
  ],
  ['implement-rules.md', '# Implement rules\n\nChange only what a finding needs.\n'],
  ['prompt-analyst.md', 'Propose lessons from the closed PR. Rules: {{knowledgeDir}}.\n'],
  ['analyst-rules.md', '# Analyst rules\n\nPropose a lesson only when the PR shows it.\n'],
] as const) {
  await importInstructionV1(db, { scope: 'global', fileKey, content });
}
// learning.spec.ts: at level 6 closing or merging a PR starts the analyst, which reads the
// repository's lessons.md; each merged PR has a comment by its author and one by a reviewer.
const learning = await upsertRepository(
  db,
  { slug: LEARNING_REPOSITORY.slug, githubFullName: LEARNING_REPOSITORY.fullName, defaultLevel: 6 },
  { installationId: LEARNING_REPOSITORY.installationId },
);
await importInstructionV1(db, {
  scope: 'repository',
  repositoryId: learning.id,
  fileKey: 'lessons.md',
  content:
    '## Changesets must match the declared bump\n\nCheck that the changeset bump matches the change.\n',
});
for (let number = LEARNING_PRS.merged.from; number <= LEARNING_PRS.merged.to; number++) {
  const { author, reviewer } = LEARNING_COMMENTS;
  github.addComment(LEARNING_REPOSITORY.fullName, number, author.login, author.body);
  github.addComment(
    LEARNING_REPOSITORY.fullName,
    number,
    reviewer.login,
    reviewer.body,
    reviewer.place,
  );
}
await seedInsightsHistory(db);
// Specs run in parallel on one stack: with every agent slot open no round waits for another
// spec's (pause-budget.spec.ts covers the queue). 20 is the most Settings allows.
await writeAppSettings(db, { ...(await getAppSettings(db)).value, agentSlots: 20 });
// Alerts of PRs without a task, and the daily budget, go to this task (alerts.spec.ts).
await writeAlertConfig(db, { ...(await getAlertConfig(db)), generalTaskId: GENERAL_ALERTS_TASK });

/** The ClickUp double; it also writes each comment to `commentsFile` for the specs. */
class RecordingClickUp extends FakeClickUpGateway {
  override async createComment(
    ...args: Parameters<FakeClickUpGateway['createComment']>
  ): Promise<{ id: string }> {
    const created = await super.createComment(...args);
    await appendFile(
      commentsFile(holdDir),
      `${JSON.stringify(this.callsOf('createComment').at(-1))}\n`,
    );
    return created;
  }
}

// One ClickUp double for the api and the worker, like one key on one server.
const { task } = NOTIFY_REPOSITORY;
const clickup = new RecordingClickUp({
  tasks: [
    ...Object.values(CLICKUP_TASKS),
    {
      ...task,
      description: 'Rename edge labels inline.',
      url: `https://app.clickup.com/t/9012/${task.customId}`,
      status: 'in progress',
      listId: null,
    },
  ],
});
const worker = await startWorker(
  {
    db,
    queue,
    logger,
    blobStore,
    github,
    gitMirror: new CliGitMirror({
      rootDir: path.join(root, 'git'),
      remoteUrl: (fullName) => (PUSHED_TO.has(fullName) ? pushRemote : fixture.dir),
      exec: loggedGit,
    }),
    agentRunner: new ScriptedAgents(holdDir, fixture.fixShas, agentCalls),
    judge: new FakeJudge(),
    analyst: new ScriptedAnalyst(holdDir),
    sandbox: loggedSandbox(sandboxCalls),
    clickup,
    // Alert comments link to the web app the specs open.
    appBaseUrl: WEB_URL,
    dataDir: path.join(root, 'data'),
  },
  { pollingIntervalSeconds: 0.5 },
);
const api = await buildServer({ db, queue, github, blobStore, clickup }, { logger: false });
await api.listen({ port: API_PORT, host: 'localhost' });

const state: StackState = {
  apiUrl: API_URL,
  databaseUrl: database.url,
  webhookSecret,
  repository: { slug: repository.slug, fullName: FULL_NAME },
  baseSha: fixture.baseSha,
  headSha: fixture.headSha,
  fixShas: fixture.fixShas,
  holdDir,
  agentCalls,
  sandboxCalls,
  pushRemote,
  gitPushes,
};
await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
logger.warn({ api: API_URL, database: database.name }, 'e2e stack ready');

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  await api.close().catch(() => {});
  await worker.stop().catch(() => {});
  await closeDb(db).catch(() => {});
  await database.drop().catch(() => {});
  await fixture.remove().catch(() => {});
  // Session knowledge folders are read-only; the run removes them, and `force` covers leftovers.
  await rm(root, { recursive: true, force: true }).catch(() => {});
  await rm(STATE_FILE, { force: true }).catch(() => {});
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop());
