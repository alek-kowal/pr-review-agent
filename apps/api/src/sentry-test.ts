// Sends one test event to Sentry: `pnpm --filter @pra/api sentry:test` locally,
// `node dist/sentry-test.js` inside the image. Exits 1 when SENTRY_DSN is not set.
import { createLogger } from '@pra/integrations/logging';
import { startObservability } from '@pra/integrations/observability';

const logger = createLogger('api');
const observability = startObservability({ service: 'api', esmLoaderHook: false });

if (!observability.sentry) {
  logger.error('SENTRY_DSN is not set; no test event sent');
  await observability.shutdown();
  process.exit(1);
}

const eventId = await observability.sendTestEvent();
logger.info({ eventId }, 'Sentry test event sent');
await observability.shutdown();
