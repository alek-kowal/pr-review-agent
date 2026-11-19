// `pnpm db:seed-repo <file> [--instructions <dir>]`: upserts a repository from a JSON seed and the
// app settings defaults, and imports instruction files as version 1. Safe to run again.
import { resolve as resolvePath } from 'node:path';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '../client.ts';
import { readSeedFile, seedRepository } from '../seed/seed-repo.ts';

const usage = 'usage: pnpm db:seed-repo <seed.json> [--instructions <dir>]';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { instructions: { type: 'string' } },
});
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('db:seed-repo: DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
if (positionals.length !== 1) {
  console.error(usage);
  process.exit(1);
}

// pnpm runs root scripts from the repository root; relative paths count from where it was called.
const cwd = process.env.INIT_CWD ?? process.cwd();
const resolve = (p: string) => resolvePath(cwd, p);
const db = createDb(url, { max: 1 });
try {
  const seed = await readSeedFile(resolve(positionals[0]!));
  const result = await seedRepository(db, seed, {
    instructionsDir: values.instructions ? resolve(values.instructions) : undefined,
  });
  const { repository, instructions } = result;
  console.log(
    `db:seed-repo: repository "${repository.slug}" (${repository.githubFullName}) upserted.`,
  );
  console.log(
    `db:seed-repo: instructions: ${instructions.imported.length} imported as version 1, ` +
      `${instructions.kept.length} already had version 1.`,
  );
} catch (error) {
  console.error('db:seed-repo failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
