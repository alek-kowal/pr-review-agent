// Production entry (`pnpm dev`, `pnpm start`): builds the api from env and listens.
import { buildServer } from './server.ts';

const server = await buildServer();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.log.info({ signal }, 'api stopping');
    void server.close().then(() => process.exit(0));
  });
}

try {
  await server.listen({
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || 'localhost',
  });
} catch (error) {
  server.log.fatal({ err: error }, 'api failed to start');
  process.exit(1);
}
