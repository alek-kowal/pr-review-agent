import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { instructionVersions, type InstructionScope } from '../schema/repositories.ts';

export type InstructionVersion = typeof instructionVersions.$inferSelect;

export type InstructionFile =
  | { scope: 'global'; repositoryId?: null; fileKey: string; content: string }
  | { scope: 'repository'; repositoryId: number; fileKey: string; content: string };

/**
 * Imports a file as version 1, active. A file that already has a version 1 keeps it: the result
 * says `kept`, and newer content belongs in a new version (S-22), not in the seed.
 */
export async function importInstructionV1(
  db: Db,
  file: InstructionFile,
): Promise<{ version: InstructionVersion; imported: boolean }> {
  const repositoryId = file.scope === 'repository' ? file.repositoryId : null;
  const [inserted] = await db
    .insert(instructionVersions)
    .values({
      scope: file.scope,
      repositoryId,
      fileKey: file.fileKey,
      version: 1,
      status: 'active',
      content: file.content,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { version: inserted, imported: true };

  const [existing] = await db
    .select()
    .from(instructionVersions)
    .where(
      and(whereFile(file.scope, repositoryId, file.fileKey), eq(instructionVersions.version, 1)),
    );
  return { version: existing!, imported: false };
}

/** Active instruction versions a review of this repository reads: global ones, then its own. */
export async function activeInstructions(
  db: Db,
  repositoryId: number,
): Promise<InstructionVersion[]> {
  return db
    .select()
    .from(instructionVersions)
    .where(
      and(
        eq(instructionVersions.status, 'active'),
        or(
          eq(instructionVersions.scope, 'global'),
          eq(instructionVersions.repositoryId, repositoryId),
        ),
      ),
    )
    .orderBy(asc(instructionVersions.scope), asc(instructionVersions.fileKey));
}

function whereFile(scope: InstructionScope, repositoryId: number | null, fileKey: string) {
  return and(
    eq(instructionVersions.scope, scope),
    repositoryId === null
      ? isNull(instructionVersions.repositoryId)
      : eq(instructionVersions.repositoryId, repositoryId),
    eq(instructionVersions.fileKey, fileKey),
  );
}
