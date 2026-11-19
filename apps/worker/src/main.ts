// Worker entry (`pnpm dev`): builds dependencies from env, starts the job handlers and stops
// gracefully on SIGTERM or SIGINT.
import {
  createAnthropicAnalyst,
  createAnthropicJudge,
  createClaudeAgentRunner,
  createOpenRouterJudge,
} from '@pra/agents';
import { modelAuthModeOf, openRouterConfigured } from '@pra/core';
import { closeDb, createDb, createQueue } from '@pra/db';
import {
  CliGitMirror,
  createBlobStore,
  createClickUpGateway,
  createGitHubGateway,
  createSandbox,
} from '@pra/integrations';
import { createLogger } from '@pra/integrations/logging';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHeartbeat, type Heartbeat } from './health/heartbeat.ts';
import { startWorker } from './worker.ts';

const logger = createLogger('worker');
const url = process.env.DATABASE_URL;
if (!url) {
  logger.fatal('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const db = createDb(url, {
  onPoolError: (error) => logger.warn({ err: error }, 'idle database connection failed'),
});
const queue = createQueue(url);
// Git mirrors and session files; relative values count from the repo root, like BLOB_DIR.
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const dataDir = path.resolve(repoRoot, process.env.DATA_DIR || '.data');
// Names only, never the value.
const authMode = modelAuthModeOf(process.env);
const openRouter = openRouterConfigured(process.env);
logger.info(
  { authMode, openRouter },
  authMode === 'none' ? 'model access not configured' : 'model access configured',
);

let worker: Awaited<ReturnType<typeof startWorker>>;
try {
  worker = await startWorker({
    db,
    queue,
    logger,
    dataDir,
    blobStore: createBlobStore(),
    github: createGitHubGateway(),
    gitMirror: new CliGitMirror({ rootDir: path.join(dataDir, 'git') }),
    agentRunner: createClaudeAgentRunner(),
    judge: createAnthropicJudge(),
    // An `openrouter/...` judge model; without OPENROUTER_API_KEY it falls back to `judge`.
    openRouterJudge: createOpenRouterJudge(),
    analyst: createAnthropicAnalyst(),
    sandbox: createSandbox(),
    clickup: createClickUpGateway(),
    appBaseUrl: process.env.APP_BASE_URL || null,
    modelAuth: authMode,
  });
} catch (error) {
  logger.fatal({ err: error }, 'worker failed to start (has `pnpm db:migrate` run?)');
  await closeDb(db);
  process.exit(1);
}

// Only in containers (deploy/compose.yaml sets it): the healthcheck reads the file's age.
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE;
const heartbeat: Heartbeat | undefined = heartbeatFile
  ? startHeartbeat(heartbeatFile, {
      onError: (error) => logger.warn({ err: error }, 'heartbeat write failed'),
    })
  : undefined;

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'worker stopping');
    heartbeat?.stop();
    void worker
      .stop()
      .then(() => closeDb(db))
      .then(() => process.exit(0));
  });
}
