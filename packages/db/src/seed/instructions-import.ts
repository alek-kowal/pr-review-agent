// S-22-T2: version 1 of each instruction file from a read-only copy of the old knowledge folder.
// The folder's files are Polish and name one repository, so the default map puts them at that
// repository's scope. Global version 1 is the built-in text used since S-01, so other repositories
// get none of its rules. Lessons start empty; lesson candidates, runs and decisions are not imported (OQ15).
import { BUILT_IN_REVIEWER_PROMPT, LEVEL_NUMBERS } from '@pra/core';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod/v4';
import type { Db, Executor } from '../client.ts';
import {
  importInstructionV1,
  type InstructionFile,
  type InstructionFileRef,
} from '../queries/instructions.ts';
import { getRepositoryBySlug } from '../queries/repositories.ts';

/** Global files whose version 1 is built-in text, not a file from the folder. */
export const BUILT_IN_GLOBAL_INSTRUCTIONS: Readonly<Record<string, string>> = {
  'prompt-reviewer.md': BUILT_IN_REVIEWER_PROMPT,
};

const ScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('global') }),
  z.object({ scope: z.literal('repository'), repository: z.string().min(1) }),
  z.object({ scope: z.literal('level'), level: z.literal([...LEVEL_NUMBERS]) }),
]);

export const InstructionsImportMapSchema = z.object({
  /** Where a file goes unless `files` names it. */
  default: ScopeSchema,
  files: z.record(z.string(), ScopeSchema).default({}),
  /** File keys never imported. */
  skip: z.array(z.string()).default([]),
  /** File keys imported as an empty version 1, whatever the folder holds. */
  empty: z.array(z.string()).default([]),
});
export type InstructionsImportMap = z.infer<typeof InstructionsImportMapSchema>;

export class InstructionsImportError extends Error {
  readonly code: 'import_map_invalid' | 'source_missing' | 'repository_unknown';

  constructor(code: InstructionsImportError['code'], message: string) {
    super(message);
    this.name = 'InstructionsImportError';
    this.code = code;
  }
}

export type InstructionsImportResult = { imported: string[]; kept: string[] };

export async function readImportMap(file: string): Promise<InstructionsImportMap> {
  const parsed = InstructionsImportMapSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
  if (!parsed.success) {
    throw new InstructionsImportError('import_map_invalid', z.prettifyError(parsed.error));
  }
  return parsed.data;
}

/**
 * Creates version 1 of every file under `from` (and of the built-in global files) in one
 * transaction. It only reads the folder. A file that has a version 1 already is kept, so a second
 * run adds nothing. Labels in the result read `<scope>:<file key>`.
 */
export async function importInstructions(
  db: Db,
  from: string,
  map: InstructionsImportMap,
): Promise<InstructionsImportResult> {
  const keys = await listFiles(from);
  const skip = new Set(map.skip);
  const wanted = [...new Set([...keys.filter((k) => !skip.has(k)), ...map.empty])].sort();
  const empty = new Set(map.empty);

  return db.transaction(async (tx) => {
    const result: InstructionsImportResult = { imported: [], kept: [] };
    const add = async (file: InstructionFile) => {
      const { imported } = await importInstructionV1(tx, file);
      result[imported ? 'imported' : 'kept'].push(`${file.scope}:${file.fileKey}`);
    };
    for (const [fileKey, content] of Object.entries(BUILT_IN_GLOBAL_INSTRUCTIONS)) {
      await add({ scope: 'global', fileKey, content });
    }
    const repositoryIds = new Map<string, number>();
    for (const fileKey of wanted) {
      const ref = await refFor(tx, fileKey, map.files[fileKey] ?? map.default, repositoryIds);
      const content = empty.has(fileKey) ? '' : await readFile(path.join(from, fileKey), 'utf8');
      await add({ ...ref, content } as InstructionFile);
    }
    return result;
  });
}

async function refFor(
  tx: Executor,
  fileKey: string,
  scope: z.infer<typeof ScopeSchema>,
  repositoryIds: Map<string, number>,
): Promise<InstructionFileRef> {
  if (scope.scope === 'global') return { scope: 'global', fileKey };
  if (scope.scope === 'level') return { scope: 'level', level: scope.level, fileKey };
  let id = repositoryIds.get(scope.repository);
  if (id === undefined) {
    const repository = await getRepositoryBySlug(tx, scope.repository);
    if (!repository) {
      throw new InstructionsImportError(
        'repository_unknown',
        `repository "${scope.repository}" is not connected; run pnpm db:seed-repo first`,
      );
    }
    id = repository.id;
    repositoryIds.set(scope.repository, id);
  }
  return { scope: 'repository', repositoryId: id, fileKey };
}

/** Every file under `dir`, as posix paths relative to it; hidden entries are left out. */
async function listFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true });
  } catch {
    throw new InstructionsImportError('source_missing', `folder not found: ${dir}`);
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .map((key) => key.split(path.sep).join('/'))
    .filter((key) => !key.split('/').some((part) => part.startsWith('.')))
    .sort();
}
