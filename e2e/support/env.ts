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
};

/** PR numbers from this one up get a failing reviewer. */
export const FAILING_PR_FROM = 400;

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

/** Insights history (insights.spec.ts): 17 merged PRs here... */
export const INSIGHTS_MAIN = { slug: 'insights-main', fullName: 'acme/insights-main' };
/** ...and 3 here. No App installation: nothing is delivered for them. */
export const INSIGHTS_SIDE = { slug: 'insights-side', fullName: 'acme/insights-side' };
