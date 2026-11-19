// S-08-T1: answers to the reviewer's questions, saved together under one signature (FR-034).
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { answers } from '../schema/reviews.ts';
import { questions, runs } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';
import type { Transactor } from './decisions.ts';
import { lockPullRequestRow } from './reviews.ts';
import { recordStateChange, recordTimelineEntry } from './timeline.ts';

/** A question's answer: its newest row, with the signer's name (kept after they leave). */
export type CurrentAnswer = {
  id: number;
  questionId: number;
  option: number | null;
  text: string;
  signedBy: string;
  signerName: string;
  savedAt: Date;
};

const answerColumns = {
  id: answers.id,
  questionId: answers.questionId,
  option: answers.option,
  text: answers.text,
  signedBy: answers.signedBy,
  signerName: teamMembers.name,
  savedAt: answers.savedAt,
};

/** The current answer of each of these questions; an open question is missing from the map. */
export async function currentAnswers(
  db: Executor,
  questionIds: readonly number[],
): Promise<Map<number, CurrentAnswer>> {
  if (questionIds.length === 0) return new Map();
  const rows = await db
    .select(answerColumns)
    .from(answers)
    .innerJoin(teamMembers, eq(teamMembers.id, answers.signedBy))
    .where(inArray(answers.questionId, [...questionIds]))
    .orderBy(desc(answers.id));
  const current = new Map<number, CurrentAnswer>();
  for (const row of rows) if (!current.has(row.questionId)) current.set(row.questionId, row);
  return current;
}

/** An answered question of a PR, as a later round's reviewer reads it (S-08-T3). */
export type PrAnswer = {
  question: string;
  options: string[];
  /** The picked option's index; null for an own answer. */
  option: number | null;
  answer: string;
  signerName: string;
  runId: number;
  savedAt: Date;
};

/** Every answered question of the PR, oldest round first, each with its current answer. */
export async function answersOfPullRequest(
  db: Executor,
  pullRequestId: number,
): Promise<PrAnswer[]> {
  const rows = await db
    .select({
      questionId: questions.id,
      question: questions.text,
      options: questions.options,
      runId: questions.runId,
    })
    .from(questions)
    .innerJoin(runs, eq(runs.id, questions.runId))
    .where(eq(runs.pullRequestId, pullRequestId))
    .orderBy(asc(runs.id), asc(questions.ordinal));
  const current = await currentAnswers(
    db,
    rows.map((row) => row.questionId),
  );
  return rows.flatMap((row) => {
    const answer = current.get(row.questionId);
    return answer
      ? [
          {
            question: row.question,
            options: row.options,
            option: answer.option,
            answer: answer.text,
            signerName: answer.signerName,
            runId: row.runId,
            savedAt: answer.savedAt,
          },
        ]
      : [];
  });
}

export type NewAnswer = {
  questionId: number;
  /** An option's index, or null with `ownText`. */
  option: number | null;
  ownText: string | null;
  /** The answer the signer saw: its id, or null when the question was open. */
  expectedAnswerId: number | null;
};

export type SaveAnswersInput = {
  pullRequestId: number;
  answers: readonly NewAnswer[];
  /** The signing Team member's id; the caller checks they are active. */
  signedBy: string;
};

/** A question answered since the signer saw it, with that answer and its signer. */
export type AnswerConflict = { questionId: number; current: CurrentAnswer | null };

export type SaveAnswersResult =
  | { ok: true; saved: CurrentAnswer[] }
  | { ok: false; reason: 'not_found'; missing: number[] }
  | { ok: false; reason: 'invalid_option'; questionIds: number[] }
  | { ok: false; reason: 'conflict'; conflicts: AnswerConflict[] };

/**
 * Saves answers to questions of one PR, all or nothing, in one transaction with one Timeline entry
 * (FR-034). Each question's row is locked and its current answer compared with the one the
 * signer saw; when any moved, nothing is written and the conflicts name who answered first
 * (Concurrent edits NFR).
 */
export async function saveAnswers(
  db: Transactor,
  input: SaveAnswersInput,
): Promise<SaveAnswersResult> {
  const byQuestion = new Map(input.answers.map((answer) => [answer.questionId, answer]));
  const ids = [...byQuestion.keys()].sort((a, b) => a - b);
  if (ids.length === 0) throw new Error('saveAnswers needs at least one answer');

  return db.transaction(async (tx) => {
    // The PR row first (see lockPullRequestRow), then the questions in id order, so two saves on
    // one PR never deadlock.
    await lockPullRequestRow(tx, input.pullRequestId);
    const locked = await tx
      .select({ id: questions.id, options: questions.options })
      .from(questions)
      .innerJoin(runs, eq(runs.id, questions.runId))
      .where(and(inArray(questions.id, ids), eq(runs.pullRequestId, input.pullRequestId)))
      .orderBy(asc(questions.id))
      .for('update', { of: questions });

    const found = new Set(locked.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) return { ok: false, reason: 'not_found', missing };

    const invalid = locked.filter((row) => {
      const answer = byQuestion.get(row.id)!;
      return answer.option !== null && !(answer.option >= 0 && answer.option < row.options.length);
    });
    if (invalid.length > 0) {
      return { ok: false, reason: 'invalid_option', questionIds: invalid.map((row) => row.id) };
    }

    const current = await currentAnswers(tx, ids);
    const moved = ids.filter(
      (id) => (current.get(id)?.id ?? null) !== byQuestion.get(id)!.expectedAnswerId,
    );
    if (moved.length > 0) {
      return {
        ok: false,
        reason: 'conflict',
        conflicts: moved.map((id) => ({ questionId: id, current: current.get(id) ?? null })),
      };
    }

    const savedAt = new Date();
    const inserted = await tx
      .insert(answers)
      .values(
        locked.map((row) => {
          const answer = byQuestion.get(row.id)!;
          return {
            questionId: row.id,
            pullRequestId: input.pullRequestId,
            option: answer.option,
            text: answer.option === null ? answer.ownText! : row.options[answer.option]!,
            signedBy: input.signedBy,
            savedAt,
          };
        }),
      )
      .returning({ id: answers.id });
    await recordTimelineEntry(tx, {
      pullRequestId: input.pullRequestId,
      actor: { kind: 'member', memberId: input.signedBy },
      kind: 'questions_answered',
      params: { count: ids.length },
      at: savedAt,
      sourceKey: `answers:${inserted[0]!.id}`,
    });
    await recordStateChange(
      tx,
      input.pullRequestId,
      { code: 'questions_answered' },
      { at: savedAt },
    );

    const saved = await currentAnswers(tx, ids);
    return { ok: true, saved: ids.map((id) => saved.get(id)!) };
  });
}
