import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod/v4';
import type { Db } from '../client.ts';
import { ensureAppSettings } from '../queries/app-settings.ts';
import { importInstructionV1, type InstructionFile } from '../queries/instructions.ts';
import { upsertRepository, type Repository } from '../queries/repositories.ts';

/**
 * A repository seed file: the repository's config (core `RepositoryConfigSchema`) and which
 * instruction files become version 1. An entry ending in `/` takes every file under that folder.
 */
export const RepositorySeedSchema = z.object({
  repository: z.record(z.string(), z.unknown()),
  instructions: z
    .object({
      global: z.array(z.string().min(1)).default([]),
      repository: z.array(z.string().min(1)).default([]),
    })
    .default({ global: [], repository: [] }),
});
export type RepositorySeed = z.output<typeof RepositorySeedSchema>;

export class SeedError extends Error {
  readonly code: 'seed_invalid' | 'instruction_file_missing';
  constructor(code: SeedError['code'], message: string) {
    super(message);
    this.name = 'SeedError';
    this.code = code;
  }
}

export type SeedResult = {
  repository: Repository;
  instructions: { imported: string[]; kept: string[] };
};

export async function readSeedFile(file: string): Promise<RepositorySeed> {
  const parsed = RepositorySeedSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    const where = parsed.error.issues.map((issue) => issue.path.join('.') || '(root)').join(', ');
    throw new SeedError('seed_invalid', `${file}: invalid seed (${where})`);
  }
  return parsed.data;
}

/**
 * Upserts the seed's repository and the `app_settings` defaults row. With `instructionsDir`, the
 * seed's instruction files are imported as version 1 (active). Running it again changes nothing.
 */
export async function seedRepository(
  db: Db,
  seed: RepositorySeed,
  options: { instructionsDir?: string } = {},
): Promise<SeedResult> {
  const files = options.instructionsDir
    ? await collectInstructionFiles(options.instructionsDir, seed.instructions)
    : [];

  return db.transaction(async (tx) => {
    const repository = await upsertRepository(tx, seed.repository);
    await ensureAppSettings(tx);

    const imported: string[] = [];
    const kept: string[] = [];
    for (const file of files) {
      const instruction: InstructionFile =
        file.scope === 'global'
          ? { scope: 'global', fileKey: file.fileKey, content: file.content }
          : {
              scope: 'repository',
              repositoryId: repository.id,
              fileKey: file.fileKey,
              content: file.content,
            };
      const result = await importInstructionV1(tx, instruction);
      (result.imported ? imported : kept).push(`${file.scope}:${file.fileKey}`);
    }
    return { repository, instructions: { imported, kept } };
  });
}

type CollectedFile = { scope: 'global' | 'repository'; fileKey: string; content: string };

async function collectInstructionFiles(
  dir: string,
  lists: RepositorySeed['instructions'],
): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];
  for (const scope of ['global', 'repository'] as const) {
    for (const entry of lists[scope]) {
      const keys = entry.endsWith('/') ? await listFolder(dir, entry) : [entry];
      for (const fileKey of keys) {
        files.push({ scope, fileKey, content: await readInstruction(dir, fileKey) });
      }
    }
  }
  return files;
}

/** File keys (`/`-separated, relative to `dir`) of every file under `folder`, sorted. */
async function listFolder(dir: string, folder: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, folder), { recursive: true, withFileTypes: true });
  } catch {
    throw new SeedError('instruction_file_missing', `instruction folder not found: ${folder}`);
  }
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
}

async function readInstruction(dir: string, fileKey: string): Promise<string> {
  const full = path.resolve(dir, fileKey);
  if (path.relative(path.resolve(dir), full).startsWith('..')) {
    throw new SeedError('seed_invalid', `instruction path leaves the folder: ${fileKey}`);
  }
  try {
    return await readFile(full, 'utf8');
  } catch {
    throw new SeedError('instruction_file_missing', `instruction file not found: ${fileKey}`);
  }
}
