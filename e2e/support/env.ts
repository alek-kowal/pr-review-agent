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
  /** A file `hold-<PR number>` here holds that PR's review session until it is removed. */
  holdDir: string;
};

/** PR numbers from this one up get a failing reviewer. */
export const FAILING_PR_FROM = 400;

/**
 * PR numbers in this range get a held reviewer: it reports one turn costing `HELD_TURN_COST_USD`,
 * then waits until the spec creates `releaseFile(number)` before it answers (live-progress.spec.ts).
 */
export const HELD_PRS = { from: 350, to: 399 };
export const HELD_TURN_COST_USD = 0.12;
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

/** Seeded at level 2: rounds run the checks and the change type, but no Verify. */
export const LEVEL_TWO_REPOSITORY = {
  slug: 'level-two-repo',
  fullName: 'acme/level-two-repo',
  installationId: 55500004,
};

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

/** Insights history (insights.spec.ts): 17 merged PRs here... */
export const INSIGHTS_MAIN = { slug: 'insights-main', fullName: 'acme/insights-main' };
/** ...and 3 here. No App installation: nothing is delivered for them. */
export const INSIGHTS_SIDE = { slug: 'insights-side', fullName: 'acme/insights-side' };
