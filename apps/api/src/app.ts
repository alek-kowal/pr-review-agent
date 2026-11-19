import * as path from 'node:path';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import type { Db, Queue } from '@pra/db';
import type { BlobStore, ClickUpGateway, GitHubGateway } from '@pra/integrations';
import { type FastifyPluginAsync } from 'fastify';
import { fileURLToPath } from 'node:url';
import { SignatureFailures } from './integrations/signature-failures.ts';
import type { LiveHub } from './live/hub.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * What the api needs from outside. `src/main.ts` builds these from env; tests pass test instances
 * or doubles.
 */
export type AppDeps = {
  db: Db;
  /** Used to send jobs; the composition root starts and stops it. */
  queue: Queue;
  /** Verifies webhook signatures (and, later, everything else the app asks of GitHub). */
  github: GitHubGateway;
  /** Raw webhook payloads. */
  blobStore: BlobStore;
  /** Settings → Integrations checks the key with it (`whoAmI`). */
  clickup: ClickUpGateway;
  /** SSE clients of `GET /api/live`; a new hub by default (tests pass one to inspect it). */
  live?: LiveHub;
};

export type AppOptions = AppDeps & Partial<AutoloadPluginOptions>;

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
    /** Webhook deliveries refused for their signature, for Settings → Integrations. */
    signatureFailures: SignatureFailures;
  }
}

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts): Promise<void> => {
  const { db, queue, github, blobStore, clickup, live, ...autoloadOptions } = opts;
  // Decorated before the plugins and routes load, so all of them see it.
  fastify.decorate('deps', { db, queue, github, blobStore, clickup, live });
  fastify.decorate('signatureFailures', new SignatureFailures());

  // Support plugins reused across the application.
  void fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    options: autoloadOptions,
    forceESM: true,
  });

  // Routes; folder names become path prefixes.
  void fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    options: autoloadOptions,
    forceESM: true,
  });
};

export default app;
export { app };
