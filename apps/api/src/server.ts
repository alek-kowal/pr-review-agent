import { loggerOptions } from '@pra/integrations/logging';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import app, { type AppDeps } from './app.ts';

/** Fastify options for the api: shared pino options and a request id on every request. */
export function serverOptions(env: NodeJS.ProcessEnv = process.env): FastifyServerOptions {
  return {
    logger: loggerOptions('api', env),
    // A caller's (or proxy's) X-Request-Id is kept; otherwise each request gets a UUID.
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  };
}

/** A Fastify instance with the app registered on `deps`, not yet listening. */
export async function buildServer(
  deps: AppDeps,
  options: FastifyServerOptions = serverOptions(),
): Promise<FastifyInstance> {
  const server = Fastify(options);
  await server.register(app, deps);
  return server;
}
