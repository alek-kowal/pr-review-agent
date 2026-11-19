// S-09-T6: the worker as a child process for `durability.test.ts`, with test doubles. Env:
// DATABASE_URL, DATA_DIR, FIXTURE_DIR (the git fixture), REPO_FULL_NAME and MODE: `block` (the
// reviewer reports one turn, then never answers, so the test can SIGKILL the worker mid-session)
// or `answer` (the reviewer answers at once).
import type { AgentRunInput, AgentRunResult } from '@pra/agents';
import { FakeAgentRunner, FakeJudge } from '@pra/agents/testing';
import { createDb, createQueue } from '@pra/db';
import { CliGitMirror, LocalBlobStore } from '@pra/integrations';
import { createLogger } from '@pra/integrations/logging';
import {
  FakeClickUpGateway,
  FakeGitHubGateway,
  FakeSandbox,
  isolatedGitExec,
} from '@pra/integrations/testing';
import * as path from 'node:path';
import { startWorker } from '../src/worker.ts';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const url = need('DATABASE_URL');
const dataDir = need('DATA_DIR');
const fixtureDir = need('FIXTURE_DIR');
const mode = need('MODE');

const ANSWER = { summary: 'Fine.', risk: 'low', findings: [], questions: [], notChecked: [] };

const block = async (input: AgentRunInput<unknown>): Promise<AgentRunResult<unknown>> => {
  input.onProgress?.({
    usage: { inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
    costUsd: 0.01,
    turns: 1,
  });
  return new Promise(() => {});
};

const agentRunner = new FakeAgentRunner();
for (let i = 0; i < 10; i += 1) {
  agentRunner.enqueue(mode === 'block' ? block : { output: ANSWER, costUsd: 0.02 });
}
const github = new FakeGitHubGateway();
github.installations.set(need('REPO_FULL_NAME'), 1);

await startWorker(
  {
    db: createDb(url, { max: 3 }),
    queue: createQueue(url, { max: 3 }),
    logger: createLogger('worker', { NODE_ENV: 'test', LOG_LEVEL: 'silent' }),
    dataDir,
    blobStore: new LocalBlobStore(path.join(dataDir, 'blobs')),
    github,
    gitMirror: new CliGitMirror({
      rootDir: path.join(dataDir, 'git'),
      remoteUrl: () => fixtureDir,
      exec: isolatedGitExec,
    }),
    agentRunner,
    judge: new FakeJudge(),
    sandbox: new FakeSandbox(),
    clickup: new FakeClickUpGateway(),
  },
  { pollingIntervalSeconds: 0.5 },
);
process.stdout.write('worker ready\n');
