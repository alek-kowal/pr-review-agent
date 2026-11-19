// `pnpm data:cleanup [--cache-max-age-days N] [--stray-max-age-hours N] [--dry-run]` (P-27): removes
// the worktrees and session files of runs no longer in progress, stray worktrees, package caches
// past their age, and the mirrors and caches of repositories no longer connected. The deploy's
// cleanup timer runs it nightly (deploy/mikrus).
import { closeDb, createDb } from '@pra/db';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cleanupData } from '../run/data-cleanup.ts';

const USAGE =
  'Usage: pnpm data:cleanup [--cache-max-age-days 7] [--stray-max-age-hours 6] [--dry-run]\n';

let values;
try {
  ({ values } = parseArgs({
    options: {
      'cache-max-age-days': { type: 'string', default: '7' },
      'stray-max-age-hours': { type: 'string', default: '6' },
      'dry-run': { type: 'boolean', default: false },
    },
  }));
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n${USAGE}`);
  process.exit(1);
}
const cacheMaxAgeDays = Number(values['cache-max-age-days']);
const strayMaxAgeHours = Number(values['stray-max-age-hours']);
if (!(cacheMaxAgeDays > 0) || !(strayMaxAgeHours > 0)) {
  process.stderr.write(`Ages must be positive numbers.\n${USAGE}`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('DATABASE_URL is not set (see .env.example)\n');
  process.exit(1);
}

// Same folder as the worker: relative values count from the repo root (src/cli or dist/cli).
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const dataDir = path.resolve(repoRoot, process.env.DATA_DIR || '.data');
const db = createDb(url, { max: 1 });
try {
  const result = await cleanupData(
    { db, dataDir },
    { cacheMaxAgeDays, strayMaxAgeHours, dryRun: values['dry-run'] },
  );
  const verb = values['dry-run'] ? 'would remove' : 'removed';
  for (const [kind, dirs] of Object.entries(result)) {
    process.stdout.write(`${kind}: ${verb} ${dirs.length}\n`);
    for (const dir of dirs) process.stdout.write(`  ${path.relative(dataDir, dir)}\n`);
  }
} finally {
  await closeDb(db);
}
