// The e2e test stack (S-01-T15): api and worker in one process on test doubles: its own
// database, `FakeGitHubGateway`, a reviewer scripted per PR number, a local blob store and a
// `CliGitMirror` on a local fixture repository. Playwright starts it (`webServer`) and stops it
// with SIGTERM; the specs read `STATE_FILE`.
import type { AgentRunInput, AgentRunner, AgentRunResult } from '@pra/agents';
import { FakeAgentRunner } from '@pra/agents/testing';
import { closeDb, createDb, createQueue, importInstructionV1, upsertRepository } from '@pra/db';
import { createTestDatabase } from '@pra/db/testing';
import { CliGitMirror, LocalBlobStore } from '@pra/integrations';
import { createLogger } from '@pra/integrations/logging';
import { createGitFixture, FakeGitHubGateway, isolatedGitExec } from '@pra/integrations/testing';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { buildServer } from '../../apps/api/src/server.ts';
import { startWorker } from '../../apps/worker/src/worker.ts';
import { API_PORT, API_URL, FAILING_PR_FROM, STATE_FILE, type StackState } from './env.ts';

const FULL_NAME = 'synergycodes/workflowbuilder';
const INSTALLATION_ID = 55500001;

/** What the reviewer answers for a PR that does not fail. */
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

/** Reads the PR number from the brief and answers per number: from `FAILING_PR_FROM`, invalid. */
class ScriptedReviewer implements AgentRunner {
  async run<T>(input: AgentRunInput<T>): Promise<AgentRunResult<T>> {
    const brief = await readFile(path.join(input.cwd, 'brief.md'), 'utf8');
    const number = Number(/PR #(\d+)/.exec(brief)?.[1]);
    const step =
      number >= FAILING_PR_FROM
        ? { output: { summary: 'not a review' }, costUsd: 0.04 }
        : { output: SCRIPTED_REVIEW, costUsd: 0.31, turns: 6 };
    return new FakeAgentRunner([step]).run(input);
  }
}

const logger = createLogger('e2e', { LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn' });
const root = await mkdtemp(path.join(tmpdir(), 'pra-e2e-'));
const [database, fixture] = await Promise.all([createTestDatabase(), createGitFixture()]);
const db = createDb(database.url, { max: 5 });
const queue = createQueue(database.url, { max: 5 });
const webhookSecret = randomBytes(16).toString('hex');
const github = new FakeGitHubGateway({
  webhookSecret,
  installations: { [FULL_NAME]: INSTALLATION_ID },
});
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

const worker = await startWorker(
  {
    db,
    queue,
    logger,
    blobStore,
    github,
    gitMirror: new CliGitMirror({
      rootDir: path.join(root, 'git'),
      remoteUrl: () => fixture.dir,
      exec: isolatedGitExec,
    }),
    agentRunner: new ScriptedReviewer(),
    dataDir: path.join(root, 'data'),
  },
  { pollingIntervalSeconds: 0.5 },
);
const api = await buildServer({ db, queue, github, blobStore }, { logger: false });
await api.listen({ port: API_PORT, host: 'localhost' });

const state: StackState = {
  apiUrl: API_URL,
  databaseUrl: database.url,
  webhookSecret,
  repository: { slug: repository.slug, fullName: FULL_NAME },
  baseSha: fixture.baseSha,
  headSha: fixture.headSha,
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
