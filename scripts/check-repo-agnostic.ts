// `node scripts/check-repo-agnostic.ts [--root <dir>]` (part of `pnpm lint`): fails when a name
// that belongs to one repository (Workflow Builder, its owner, the old tool) appears in `apps/` or
// `packages/` outside tests and test fixtures (NFR Repository-agnostic, S-20-T5). A repository
// differs only by its settings, so its names belong in the database, never in source.
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Names that belong to one repository. Bare `WB` stays allowed: `WB-123` is the task id example. */
export const REPOSITORY_NAMES: readonly RegExp[] = [
  /workflow[\s_-]?builder/i,
  /synergy[\s_-]?codes/i,
  /wb[\s_-]?factory/i,
];

/** The folders scanned, from the repository root. */
export const SCANNED_DIRS = ['apps', 'packages'] as const;

/** Folders never scanned: tests, test doubles and fixtures, and tool output. */
const SKIPPED_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  'test',
  'tests',
  '__tests__',
  'testing',
  'fixtures',
  'e2e',
]);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Files allowed to name the old tool, each with its reason. */
const ALLOWED_FILES: Record<string, string> = {
  // The porting map lists the old tool's tests by their path.
  'packages/core/PORTING.md': 'maps the tests of ~/Projects/wb-factory',
};

export type Hit = { file: string; line: number; name: string };

/** Every repository-specific name under `root`'s scanned folders, as repository-relative paths. */
export async function findRepositoryNames(root: string): Promise<Hit[]> {
  const hits: Hit[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of await filesUnder(root, dir)) {
      if (file in ALLOWED_FILES) continue;
      const text = await readFile(path.join(root, file), 'utf8');
      if (text.includes('\0')) continue;
      text.split('\n').forEach((content, index) => {
        for (const pattern of REPOSITORY_NAMES) {
          const match = pattern.exec(content);
          if (match) hits.push({ file, line: index + 1, name: match[0] });
        }
      });
    }
  }
  return hits;
}

async function filesUnder(root: string, dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(root, dir), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) files.push(...(await filesUnder(root, relative)));
    } else if (entry.isFile() && !TEST_FILE.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  const root = path.resolve(
    values.root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  );
  const hits = await findRepositoryNames(root);
  for (const hit of hits) {
    process.stderr.write(`${hit.file}:${hit.line}: repository-specific name "${hit.name}"\n`);
  }
  if (hits.length > 0) {
    process.stderr.write(
      'check-repo-agnostic: a repository differs only by its settings; move these names to ' +
        'Settings → Repositories, a test or a test fixture.\n',
    );
    process.exitCode = 1;
  }
}
