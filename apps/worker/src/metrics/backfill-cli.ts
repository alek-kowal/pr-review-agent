// `pnpm --filter @pra/worker metrics:backfill`: writes the metric source rows (S-19-T1) from every
// stored `pull_request` event. Safe to run again; reads the root `.env` like the worker.
import { closeDb, createDb, pullRequestEventsInOrder } from '@pra/db';
import { createBlobStore, createGitHubGateway } from '@pra/integrations';
import { createLogger } from '@pra/integrations/logging';
import { backfillMetricLogs } from './metric-logs.ts';

const logger = createLogger('metrics-backfill');
const url = process.env.DATABASE_URL;
if (!url) {
  logger.fatal('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const db = createDb(url);
try {
  const result = await backfillMetricLogs(
    { db, logger, blobStore: createBlobStore(), github: createGitHubGateway() },
    await pullRequestEventsInOrder(db),
  );
  logger.info(result, 'metric logs backfilled');
} catch (error) {
  logger.fatal({ err: error }, 'metric backfill failed (has `pnpm db:migrate` run?)');
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
