import * as path from 'node:path';
import AutoLoad, { type AutoloadPluginOptions } from '@fastify/autoload';
import type { Db, Queue } from '@pra/db';
import { type FastifyPluginAsync } from 'fastify';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * What the api needs from outside. `src/main.ts` builds these from env; tests pass test instances
 * or doubles. S-01 adds the blob store and GitHub.
 */
export type AppDeps = {
  db: Db;
  /** Used to send jobs; the composition root starts and stops it. */
  queue: Queue;
};

export type AppOptions = AppDeps & Partial<AutoloadPluginOptions>;

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

const app: FastifyPluginAsync<AppOptions> = async (fastify, opts): Promise<void> => {
  const { db, queue, ...autoloadOptions } = opts;
  // Decorated before the plugins and routes load, so all of them see it.
  fastify.decorate('deps', { db, queue });

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
