// Ports and the state file of one e2e run. Derived from the checkout path, so runs from several
// worktrees never share a server; Playwright's config and the specs compute the same values.
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const checkout = createHash('sha1').update(process.cwd()).digest().readUInt16BE(0) % 700;

export const WEB_PORT = Number(process.env.E2E_PORT ?? 5200 + checkout);
export const API_PORT = Number(process.env.E2E_API_PORT ?? WEB_PORT + 7000);
export const WEB_URL = `http://localhost:${WEB_PORT}`;
export const API_URL = `http://localhost:${API_PORT}`;
/** Written by `stack.ts` once the stack is up; read by the specs. */
export const STATE_FILE = path.join(tmpdir(), `pra-e2e-${WEB_PORT}.json`);

export type StackState = {
  apiUrl: string;
  databaseUrl: string;
  webhookSecret: string;
  repository: { slug: string; fullName: string };
  baseSha: string;
  headSha: string;
  /** Commits on the PR branch after `headSha`, in order: pushes after the reviewed head. */
  fixShas: string[];
  /**
   * A file `hold-<PR number>` here holds that PR's review session until it is removed. The
   * reviewer double also writes the brief of a PR's k-th full review here (`briefFile`).
   */
  holdDir: string;
  /**
   * JSON lines `{ role, model, dirs }`, one per agent session the doubles answered; `dirs` holds
   * the session's cwd and read dirs (a run's worktree path ends in `run-<id>`).
   */
  agentCalls: string;
  /** JSON lines `{ command, mounts }`, one per Sandbox call; mounts are host paths (`run-<id>`). */
  sandboxCalls: string;
  /** The push repository's bare remote (`PUSH_REPOSITORY`). */
  pushRemote: string;
  /** JSON lines `{ args }`, one per `git push` the worker ran (its argv, never the token). */
  gitPushes: string;
};

/**
 * Seeded without a level of its own: its rounds start at the global default level
 * (models-levels-audit.spec.ts). No other spec uses it, so changing the default is safe.
 */
export const GLOBAL_LEVEL_REPOSITORY = {
  slug: 'global-level-repo',
  fullName: 'acme/global-level-repo',
  installationId: 55500009,
};

/** The brief the reviewer double got for PR `number`'s k-th full review (from 1). */
export const briefFile = (holdDir: string, number: number, k: number): string =>
  path.join(holdDir, `brief-${number}-${k}.md`);

/** The `lessons.md` that review read, when its knowledge folder had one (learning.spec.ts). */
export const lessonsFile = (holdDir: string, number: number, k: number): string =>
  path.join(holdDir, `lessons-${number}-${k}.md`);

/**
 * PR numbers in this range get a reviewer that asks 2 questions; once the brief carries the
 * team's answers it asks none and adds one finding (questions-reviews.spec.ts). Level 1 drops
 * questions, so the spec uses `LEVEL_TWO_REPOSITORY`.
 */
export const QUESTION_PRS = { from: 270, to: 279 };

/** PR numbers from this one up get a failing reviewer. */
export const FAILING_PR_FROM = 400;

/** PR numbers in this range get a reviewer that fails its first session only (retry-cancel.spec.ts). */
export const FAIL_ONCE_PRS = { from: 150, to: 159 };

/**
 * PR numbers in this range get a held reviewer: it reports one turn costing `HELD_TURN_COST_USD`,
 * then waits until the spec creates `releaseFile(number)` before it answers (live-progress.spec.ts).
 */
export const HELD_PRS = { from: 350, to: 399 };
export const HELD_TURN_COST_USD = 0.12;

/**
 * PR numbers in this range get a reviewer that fails its first session and costs
 * `COSTLY_RETRY_USD` on the retry, which passes the $5 cost alert (alerts.spec.ts).
 */
export const COSTLY_RETRY_PRS = { from: 160, to: 169 };
export const COSTLY_RETRY_USD = 5.5;

/** The general alerts task the stack sets in `alert_config` (alerts.spec.ts). */
export const GENERAL_ALERTS_TASK = 'WB-700';

/**
 * PR numbers of instructions.spec.ts. Their reviewer answers with `TRIAL_RULE_FINDING` in place of
 * the Nit when the review rules it reads hold `trialRule(number)`, so a trial's run B differs.
 */
export const TRIAL_PRS = { from: 290, to: 297 };
export const trialRule = (number: number): string => `Check public API names on #${number}.`;
export const TRIAL_RULE_FINDING = {
  title: 'Public API rename has no changelog note',
  severity: 'should',
  file: 'packages/sdk/src/index.ts',
  line: 8,
  scenario: 'Consumers upgrade and their imports break without a word in the changelog.',
  suggestion: 'Add a changelog line for the renamed export.',
} as const;
export const releaseFile = (number: number): string =>
  path.join(tmpdir(), `pra-e2e-${WEB_PORT}-release-${number}`);

/** A repository the GitHub App double reaches that no seed connects. */
export const SECOND_REPOSITORY = { fullName: 'acme/second-repo', installationId: 55500002 };

/** Seeded at level 3 with the migration as a sensitive file, so Verify checks every finding. */
export const VERIFIED_REPOSITORY = {
  slug: 'verified-repo',
  fullName: 'acme/verified-repo',
  installationId: 55500003,
};

/**
 * Seeded at level 3 with no sensitive files: round 1 verifies its findings, and the PR page can
 * raise a PR to level 4 for Implement with agent (implement-patch.spec.ts).
 */
export const IMPLEMENTER_REPOSITORY = {
  slug: 'implementer-repo',
  fullName: 'acme/implementer-repo',
  installationId: 55500011,
};

/** While a file of this name exists in the hold folder, every implementer session waits. */
export const IMPLEMENTER_HOLD = 'hold-implementer';

/**
 * Seeded at level 4 (push-recheck.spec.ts). Its remote is a bare copy of the fixture that
 * accepts pushes (`StackState.pushRemote`); each PR in `PUSH_PRS` has its own branch there
 * (`pushBranch`), at the fixture head. GitHub compares its commits with git and reports green CI
 * at any commit.
 */
export const PUSH_REPOSITORY = {
  slug: 'push-repo',
  fullName: 'acme/push-repo',
  installationId: 55500012,
};
export const PUSH_PRS = { from: 265, to: 267 };
export const pushBranch = (number: number): string => `edge-labels-${number}`;
/** The GitHub account of the Team member who signs pushes (`Co-authored-by`). */
export const PUSH_SIGNER = { login: 'wb-dev', id: 4242 };
/** While this file exists, GitHub reports its content as PR `number`'s head (push repository). */
export const movedHeadFile = (holdDir: string, number: number): string =>
  path.join(holdDir, `moved-head-${number}`);

/** Seeded at level 2: rounds run the checks and the change type, but no Verify. */
export const LEVEL_TWO_REPOSITORY = {
  slug: 'level-two-repo',
  fullName: 'acme/level-two-repo',
  installationId: 55500004,
};

/** Seeded at level 2 with a 1-line large-PR threshold: every PR there is large. */
export const LARGE_PR_REPOSITORY = {
  slug: 'large-pr-repo',
  fullName: 'acme/large-pr-repo',
  installationId: 55500006,
};

/** CI on the fixture head in the level-two and large-PR repositories: 2 passed, 1 failed. */
export const FIXTURE_CI = [
  { name: 'build', source: 'check_run', state: 'passed' },
  { name: 'lint', source: 'check_run', state: 'passed' },
  { name: 'e2e', source: 'status', state: 'failed' },
] as const;

/**
 * Seeded at level 1 with two sensitive patterns that match two of the fixture's changed files:
 * the migration and the SDK entry (sensitive-files.spec.ts).
 */
export const SENSITIVE_REPOSITORY = {
  slug: 'sensitive-repo',
  fullName: 'acme/sensitive-repo',
  installationId: 55500005,
  patterns: [
    { pattern: 'db/migrations/**', reason: 'Migrations cannot be undone.' },
    { pattern: 'packages/sdk/src/index.ts', reason: 'The public SDK entry.' },
  ],
};

/**
 * Seeded at level 1 (merge.spec.ts): GitHub's CI is green at the fixture head, but the app learns
 * it only from a `check_suite` delivery; GitHub refuses every merge of a PR in `REFUSED_MERGE_PRS`.
 */
export const MERGE_REPOSITORY = {
  slug: 'merge-repo',
  fullName: 'acme/merge-repo',
  installationId: 55500006,
};
export const REFUSED_MERGE_PRS = { from: 110, to: 119 };
export const MERGE_REFUSAL = {
  status: 405,
  message: 'At least 1 approving review is required by reviewers with write access.',
};

/**
 * Seeded at level 2 with ClickUp settings (clickup-link.spec.ts): task IDs look like `WB-123`, and
 * the ClickUp double knows `CLICKUP_TASKS`. The fixture branch and the specs' titles carry no ID.
 */
export const CLICKUP_REPOSITORY = {
  slug: 'clickup-repo',
  fullName: 'acme/clickup-repo',
  installationId: 55500007,
  clickup: {
    workspaceId: '9012',
    spaceId: null,
    followUpListId: 'list-follow-ups',
    taskIdPattern: 'WB-\\d+',
  },
};
/** The tasks the ClickUp double answers: one a branch names, one a person links by hand. */
export const CLICKUP_TASKS = {
  branch: {
    id: '86c0e2e01',
    customId: 'WB-4821',
    name: 'Rename edge labels inline',
    description:
      'Double-click an edge label to rename it. An empty label falls back to the edge id.',
    url: 'https://app.clickup.com/t/86c0e2e01',
    status: 'in progress',
    listId: 'list-wb-sprint',
  },
  hand: {
    id: '86c0e2e02',
    customId: 'WB-4822',
    name: 'Keep edge labels in the undo history',
    description: 'Renaming a label is one undo step.',
    url: 'https://app.clickup.com/t/86c0e2e02',
    status: 'to do',
    listId: 'list-wb-sprint',
  },
};

/**
 * Seeded at level 1 with ClickUp settings; the ClickUp double knows `task` (notify-author.spec.ts).
 * The double appends each `createComment` call as one JSON line to `commentsFile(holdDir)`.
 */
export const NOTIFY_REPOSITORY = {
  slug: 'notify-repo',
  fullName: 'acme/notify-repo',
  installationId: 55500008,
  task: { id: '86c1abc', customId: 'WB-123', name: 'Inline edge labels' },
};
export const commentsFile = (holdDir: string): string =>
  path.join(holdDir, 'clickup-comments.jsonl');

/**
 * Seeded at level 6 with a `lessons.md` v1 (learning.spec.ts): closing or merging a PR starts the
 * analyst. Its double keeps each input (`analystInputFile`), waits while `analystHoldFile` exists,
 * then proposes the lesson of the PR's range in `LEARNING_PRS`, or none.
 */
export const LEARNING_REPOSITORY = {
  slug: 'learning-repo',
  fullName: 'acme/learning-repo',
  installationId: 55500009,
};
/** Each range is one PR number plus the retry (0 to 2). */
export const LEARNING_PRS = {
  /** Closed earlier; the analyst proposes `LEARNING_LESSONS.source`. */
  source: { from: 241, to: 243 },
  /** Closed earlier; the analyst proposes `LEARNING_LESSONS.snapshot`. */
  snapshot: { from: 244, to: 246 },
  /** Merged in the app; the analyst proposes `LEARNING_LESSONS.snapshot` again. */
  merged: { from: 247, to: 249 },
  /** Reviewed after the lesson is accepted. */
  next: { from: 250, to: 252 },
};
/** Lessons of prototype flow E: one proposed on 2 PRs, one on a single PR. */
export const LEARNING_LESSONS = {
  snapshot: {
    title: 'Snapshot tables must be generated or tested',
    lesson:
      'When a README table lists files that a build script copies, ask for a test that compares the table with the script.',
  },
  source: {
    title: 'Fix at the source, not at the consumer',
    lesson:
      'When a PR works around a visual mismatch with an override in one place of use, check whether the component renders wrongly elsewhere too.',
  },
};
/**
 * GitHub comments on each PR in `LEARNING_PRS.merged`: one by the PR's author (`wb-dev`, the
 * fixtures' author), which the analyst must not read, and one by a reviewer on a line.
 */
export const LEARNING_COMMENTS = {
  author: { login: 'wb-dev', body: 'I will regenerate the table by hand next time.' },
  reviewer: {
    login: 'tomek-wb',
    body: 'Same gap as in #244: the snapshot table and the build drifted apart.',
    place: { path: 'apps/demo/src/edges.ts', line: 1 },
  },
};
/** What the analyst double got for PR `number`, as JSON. */
export const analystInputFile = (holdDir: string, number: number): string =>
  path.join(holdDir, `analyst-input-${number}.json`);
/** While this file exists, the analyst double holds PR `number`'s analysis. */
export const analystHoldFile = (holdDir: string, number: number): string =>
  path.join(holdDir, `hold-analyst-${number}`);

/** Insights history (insights.spec.ts): 17 merged PRs here... */
export const INSIGHTS_MAIN = { slug: 'insights-main', fullName: 'acme/insights-main' };
/** ...and 3 here. No App installation: nothing is delivered for them. */
export const INSIGHTS_SIDE = { slug: 'insights-side', fullName: 'acme/insights-side' };

/**
 * Seeded at level 3 with green CI for the README screenshots (`pnpm readme:shots`,
 * e2e/readme/shots.readme.ts). No spec uses it or `README_PRS`.
 */
export const README_REPOSITORY = {
  slug: 'readme-demo',
  fullName: 'acme/readme-demo',
  installationId: 55500010,
};
export const README_PRS = { from: 80, to: 89 };
