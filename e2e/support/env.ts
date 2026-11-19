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
