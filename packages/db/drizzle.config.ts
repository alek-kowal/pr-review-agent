import { defineConfig } from 'drizzle-kit';

// `pnpm db:generate` writes SQL migrations from the schema; `pnpm db:migrate` applies them.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
});
