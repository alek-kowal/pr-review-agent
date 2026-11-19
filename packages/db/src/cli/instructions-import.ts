// `pnpm instructions:import --from <dir> [--map <file>]`: creates version 1 of each instruction
// file from a read-only copy of the old knowledge folder (S-22-T2). The default map is
// `packages/db/src/testing/fixtures/instructions-import.json`. Safe to run again; it never writes
// to `<dir>`.
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { closeDb, createDb } from '../client.ts';
import { importInstructions, readImportMap } from '../seed/instructions-import.ts';

const DEFAULT_MAP = fileURLToPath(
  new URL('../testing/fixtures/instructions-import.json', import.meta.url),
);
const usage = 'usage: pnpm instructions:import --from <dir> [--map <instructions-import.json>]';

const { values } = parseArgs({
  options: { from: { type: 'string' }, map: { type: 'string' } },
});
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('instructions:import: DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
if (!values.from) {
  console.error(usage);
  process.exit(1);
}

// pnpm runs root scripts from the repository root; relative paths count from where it was called.
const cwd = process.env.INIT_CWD ?? process.cwd();
const resolve = (p: string) => resolvePath(cwd, p);
const db = createDb(url, { max: 1 });
try {
  const map = await readImportMap(values.map ? resolve(values.map) : DEFAULT_MAP);
  const { imported, kept } = await importInstructions(db, resolve(values.from), map);
  console.log(
    `instructions:import: ${imported.length} imported as version 1, ` +
      `${kept.length} already had version 1.`,
  );
} catch (error) {
  console.error('instructions:import failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb(db);
}
