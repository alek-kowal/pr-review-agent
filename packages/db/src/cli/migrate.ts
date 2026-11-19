// `pnpm db:migrate`: applies pending migrations to DATABASE_URL (the root script loads `.env`).
import { migrateDatabase } from '../migrate.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('db:migrate: DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}

try {
  const { applied, total, queueSchemaVersion } = await migrateDatabase(url);
  console.log(`db:migrate: ${applied} new Drizzle migration(s) applied, ${total} in total.`);
  console.log(`db:migrate: pg-boss schema "pgboss" at version ${queueSchemaVersion}.`);
} catch (error) {
  console.error('db:migrate failed:', error);
  process.exit(1);
}
