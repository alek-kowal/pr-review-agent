// STAGEFILES: which instruction files each stage reads, at global scope and per repository.
import {
  isEmptyStageFileChoice,
  type FileStageKey,
  type StageFileChoice,
  type StageFileChoices,
} from '@pra/core';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { stageFileChoices } from '../schema/stage-files.ts';

type ChoiceRow = typeof stageFileChoices.$inferSelect;

/** A row as a choice: only the slots it sets. */
export function choiceOfRow(
  row: Pick<ChoiceRow, 'prompt' | 'rules' | 'documents'>,
): StageFileChoice {
  const choice: StageFileChoice = {};
  if (row.prompt !== null) choice.prompt = row.prompt;
  if (row.rules !== null) choice.rules = row.rules;
  if (row.documents !== null) choice.documents = row.documents;
  return choice;
}

const whereTarget = (repositoryId: number | null) =>
  repositoryId === null
    ? isNull(stageFileChoices.repositoryId)
    : eq(stageFileChoices.repositoryId, repositoryId);

/**
 * The global choices and, for a repository, its overrides (`repository` is empty at global
 * scope), as core `resolveStageFiles` reads them.
 */
export async function stageFileChoicesOf(
  db: Executor,
  repositoryId: number | null,
): Promise<StageFileChoices> {
  const rows = await db
    .select()
    .from(stageFileChoices)
    .where(
      repositoryId === null
        ? isNull(stageFileChoices.repositoryId)
        : or(
            isNull(stageFileChoices.repositoryId),
            eq(stageFileChoices.repositoryId, repositoryId),
          ),
    );
  const out: StageFileChoices = { global: {}, repository: {} };
  for (const row of rows) {
    const choice = choiceOfRow(row);
    if (isEmptyStageFileChoice(choice)) continue;
    (row.repositoryId === null ? out.global : out.repository)[row.stage] = choice;
  }
  return out;
}

/** Every stored choice: the global ones and each repository's overrides by repository id. */
export async function allStageFileChoices(db: Executor): Promise<{
  global: StageFileChoices['global'];
  repositories: Map<number, StageFileChoices['repository']>;
}> {
  const rows = await db.select().from(stageFileChoices);
  const global: StageFileChoices['global'] = {};
  const repositories = new Map<number, StageFileChoices['repository']>();
  for (const row of rows) {
    const choice = choiceOfRow(row);
    if (isEmptyStageFileChoice(choice)) continue;
    if (row.repositoryId === null) {
      global[row.stage] = choice;
      continue;
    }
    const mine = repositories.get(row.repositoryId) ?? {};
    mine[row.stage] = choice;
    repositories.set(row.repositoryId, mine);
  }
  return { global, repositories };
}

/**
 * One stage's choice at one scope, locked until the transaction ends (null when nothing is
 * stored). Locks a placeholder row so two signed saves of the same target queue up; the write
 * removes it again when the choice stays empty, and a rolled-back transaction never keeps it.
 */
export async function lockStageFileChoice(
  tx: Executor,
  repositoryId: number | null,
  stage: FileStageKey,
): Promise<StageFileChoice | null> {
  await tx.insert(stageFileChoices).values({ repositoryId, stage }).onConflictDoNothing();
  const [row] = await tx
    .select()
    .from(stageFileChoices)
    .where(and(whereTarget(repositoryId), eq(stageFileChoices.stage, stage)))
    .for('update');
  const choice = row ? choiceOfRow(row) : null;
  return isEmptyStageFileChoice(choice) ? null : choice;
}

/** Stores one stage's choice at one scope; null or a choice that sets nothing removes the row. */
export async function writeStageFileChoice(
  tx: Executor,
  repositoryId: number | null,
  stage: FileStageKey,
  choice: StageFileChoice | null,
): Promise<void> {
  const where = and(whereTarget(repositoryId), eq(stageFileChoices.stage, stage));
  if (isEmptyStageFileChoice(choice)) {
    await tx.delete(stageFileChoices).where(where);
    return;
  }
  const values = {
    prompt: choice!.prompt ?? null,
    rules: choice!.rules ?? null,
    documents: choice!.documents ?? null,
  };
  await tx
    .insert(stageFileChoices)
    .values({ repositoryId, stage, ...values })
    .onConflictDoUpdate({
      target: [stageFileChoices.repositoryId, stageFileChoices.stage],
      set: { ...values, updatedAt: sql`now()` },
    });
}
