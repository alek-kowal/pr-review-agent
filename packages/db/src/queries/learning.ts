// Learning (S-23): analyses of closed PRs, the lesson candidates they propose, and the accept that
// turns a candidate into a new active `lessons.md` version of its repository.
import {
  BOT,
  diffSummary,
  HAND,
  lineDiff,
  mergeCandidates,
  planRun,
  withLesson,
  type LessonCandidate,
  type LessonProposal,
} from '@pra/core';
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { Executor } from '../client.ts';
import { instructionFiles, instructionVersions } from '../schema/instructions.ts';
import {
  analyses,
  lessonCandidates,
  lessonCandidateSources,
  type AnalysisStatus,
} from '../schema/learning.ts';
import { pullRequests, repositories } from '../schema/repositories.ts';
import { runs } from '../schema/runs.ts';
import { teamMembers } from '../schema/team.ts';
import {
  ensureInstructionFile,
  lockActiveInstructionVersion,
  saveInstructionDraft,
  type InstructionVersionRow,
} from './instructions.ts';
import { getAppSettings } from './app-settings.ts';
import type { Transactor } from './decisions.ts';
import { prLevel } from './pr-state.ts';
import { isUniqueViolation, type Run } from './runs.ts';
import { insertSettingsChange } from './settings-changes.ts';
import { createRun, type RunStartDeps } from './start-round.ts';

export type Analysis = typeof analyses.$inferSelect;
export type LessonCandidateRow = typeof lessonCandidates.$inferSelect;

/** The repository's lessons file: accepted lessons land here, read by every later round. */
export const LESSONS_FILE_KEY = 'lessons.md';
/** The line an empty lessons file holds; the first accepted lesson replaces it. */
export const LESSONS_PLACEHOLDER = 'No accepted lessons yet.';

export type StartAnalysisInput = { pullRequestId: number; startedBy: 'bot' | 'hand' };

export type StartAnalysisResult =
  | { started: true; analysis: Analysis; run: Run }
  | { started: false; reason: 'pr_not_found' | 'pr_open' | 'already_analysed' };

/**
 * Starts the analyst on a closed PR: the analysis row and a run of kind `analyst`, in one
 * transaction, then its `analyse` stage job. The bot analyses a PR once (`already_analysed` on a
 * repeated `closed`); a person may start it again by hand. The run never holds the PR.
 */
export async function startAnalysis(
  deps: RunStartDeps,
  input: StartAnalysisInput,
): Promise<StartAnalysisResult> {
  const [row] = await deps.db
    .select({ repository: repositories, pullRequest: pullRequests })
    .from(pullRequests)
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(eq(pullRequests.id, input.pullRequestId));
  if (!row) return { started: false, reason: 'pr_not_found' };
  const { repository, pullRequest } = row;
  if (pullRequest.state === 'open') return { started: false, reason: 'pr_open' };
  const level = prLevel(
    repository,
    pullRequest,
    (await getAppSettings(deps.db)).value.defaultLevel,
  );
  let analysis: Analysis | undefined;
  try {
    const created = await createRun(deps, {
      pullRequest,
      kind: 'analyst',
      level,
      plan: planRun({ kind: 'analyst', level }),
      trigger: input.startedBy === 'bot' ? 'pr_closed' : 'manual',
      startedBy: input.startedBy === 'bot' ? BOT : HAND,
      beforeInsert: async (tx) => {
        [analysis] = await tx
          .insert(analyses)
          .values({ pullRequestId: pullRequest.id, startedBy: input.startedBy })
          .returning();
      },
      inTransaction: async (tx, run) => {
        [analysis] = await tx
          .update(analyses)
          .set({ runId: run.id })
          .where(eq(analyses.id, analysis!.id))
          .returning();
      },
    });
    // Analyst runs never block, so a start is never refused.
    if (!created.created) throw new Error(`analyst run not created: ${created.reason}`);
    return { started: true, analysis: analysis!, run: created.run };
  } catch (error) {
    if (isUniqueViolation(error, 'analyses_one_by_bot')) {
      return { started: false, reason: 'already_analysed' };
    }
    throw error;
  }
}

export async function analysisOfRun(db: Executor, runId: number): Promise<Analysis | null> {
  const [row] = await db.select().from(analyses).where(eq(analyses.runId, runId));
  return row ?? null;
}

export type AnalysisSummary = Analysis & { costUsd: number; runStatus: string | null };

/** The PR's latest analysis with its run's cost, or null when none ran. */
export async function latestAnalysisOf(
  db: Executor,
  pullRequestId: number,
): Promise<AnalysisSummary | null> {
  const [row] = await db
    .select({ analysis: analyses, costUsd: runs.costUsd, runStatus: runs.status })
    .from(analyses)
    .leftJoin(runs, eq(runs.id, analyses.runId))
    .where(eq(analyses.pullRequestId, pullRequestId))
    .orderBy(desc(analyses.createdAt), desc(analyses.id))
    .limit(1);
  return row ? { ...row.analysis, costUsd: row.costUsd ?? 0, runStatus: row.runStatus } : null;
}

/** The candidates of a repository as core reads them: ids as strings, PRs by their row id. */
async function candidatesOfRepository(
  tx: Executor,
  repositoryId: number,
): Promise<LessonCandidate[]> {
  const rows = await tx
    .select()
    .from(lessonCandidates)
    .where(eq(lessonCandidates.repositoryId, repositoryId))
    .orderBy(asc(lessonCandidates.id));
  const sources = rows.length
    ? await tx
        .select({
          candidateId: lessonCandidateSources.candidateId,
          pullRequestId: lessonCandidateSources.pullRequestId,
        })
        .from(lessonCandidateSources)
        .where(
          inArray(
            lessonCandidateSources.candidateId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(asc(lessonCandidateSources.id))
    : [];
  return rows.map((r) => ({
    id: String(r.id),
    title: r.title,
    rule: r.text,
    prs: sources.filter((s) => s.candidateId === r.id).map((s) => s.pullRequestId),
    status: r.status,
  }));
}

/** Open candidates of a repository, id and title, for the analyst's input. */
export async function openCandidatesOf(
  db: Executor,
  repositoryId: number,
): Promise<{ id: string; title: string }[]> {
  const rows = await db
    .select({ id: lessonCandidates.id, title: lessonCandidates.title })
    .from(lessonCandidates)
    .where(
      and(eq(lessonCandidates.repositoryId, repositoryId), eq(lessonCandidates.status, 'proposed')),
    )
    .orderBy(asc(lessonCandidates.id));
  return rows.map((r) => ({ id: String(r.id), title: r.title }));
}

/** One candidate as the analyst proposed it. */
export type ProposedLesson = {
  title: string;
  lesson: string;
  evidence: string;
  duplicateOf?: string | null;
};

export type FinishAnalysisResult =
  { finished: false } | { finished: true; created: number[]; merged: number[] };

/**
 * Stores a finished analysis: core `mergeCandidates` over the repository's candidates (at most 5
 * new, a duplicate raises a candidate's PR count, the same PR never counts twice), then the status
 * `finished` with the number of candidates it touched. Does nothing unless the analysis is still
 * running, so a repeated call is harmless.
 */
export async function finishAnalysis(
  db: Transactor,
  input: { analysisId: number; proposals: readonly ProposedLesson[] },
): Promise<FinishAnalysisResult> {
  return db.transaction(async (tx) => {
    const [analysis] = await tx
      .select({ analysis: analyses, repositoryId: pullRequests.repositoryId })
      .from(analyses)
      .innerJoin(pullRequests, eq(pullRequests.id, analyses.pullRequestId))
      .where(eq(analyses.id, input.analysisId))
      .for('update', { of: analyses });
    if (!analysis || analysis.analysis.status !== 'running') return { finished: false };
    const { repositoryId } = analysis;
    const pullRequestId = analysis.analysis.pullRequestId;
    // One merge per repository at a time, so two analyses never add the same candidate twice.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('lesson_candidates'), ${repositoryId})`,
    );

    const existing = await candidatesOfRepository(tx, repositoryId);
    const proposals: LessonProposal[] = input.proposals.map((p, i) => ({
      id: `new:${i}`,
      title: p.title.trim(),
      rule: p.lesson.trim(),
      pr: pullRequestId,
      duplicateOf: p.duplicateOf ?? null,
    }));
    const merge = mergeCandidates(existing, proposals);
    // One reason per kept proposal, in order, naming the candidate it landed on: a candidate's
    // evidence is that of the first proposal that landed on it.
    const evidenceFor = (candidateId: string): string => {
      const index = merge.reasons.findIndex(
        (r) => (r.params as { id?: string }).id === candidateId,
      );
      return index >= 0 ? (input.proposals[index]?.evidence.trim() ?? '') : '';
    };

    const created: number[] = [];
    for (const id of merge.created) {
      const candidate = merge.candidates.find((c) => c.id === id)!;
      const [row] = await tx
        .insert(lessonCandidates)
        .values({
          repositoryId,
          title: candidate.title,
          text: candidate.rule,
          evidence: evidenceFor(id),
          prCount: 1,
        })
        .returning({ id: lessonCandidates.id });
      created.push(row!.id);
      await tx.insert(lessonCandidateSources).values({
        candidateId: row!.id,
        pullRequestId,
        analysisId: input.analysisId,
        evidence: evidenceFor(id),
      });
    }
    const merged: number[] = [];
    for (const id of merge.merged) {
      const candidateId = Number(id);
      merged.push(candidateId);
      await tx
        .insert(lessonCandidateSources)
        .values({
          candidateId,
          pullRequestId,
          analysisId: input.analysisId,
          evidence: evidenceFor(id),
        })
        .onConflictDoNothing();
      await tx
        .update(lessonCandidates)
        .set({
          prCount: sql`(select count(distinct ${lessonCandidateSources.pullRequestId})::int from ${lessonCandidateSources} where ${lessonCandidateSources.candidateId} = ${candidateId})`,
          updatedAt: new Date(),
        })
        .where(eq(lessonCandidates.id, candidateId));
    }
    await tx
      .update(analyses)
      .set({
        status: 'finished',
        candidateCount: created.length + merged.length,
        finishedAt: new Date(),
      })
      .where(eq(analyses.id, input.analysisId));
    return { finished: true, created, merged };
  });
}

/** Marks a running analysis as ended without candidates (its run failed or was cancelled). */
export async function endAnalysis(
  db: Executor,
  analysisId: number,
  status: Exclude<AnalysisStatus, 'running'>,
): Promise<void> {
  await db
    .update(analyses)
    .set({ status, finishedAt: new Date() })
    .where(and(eq(analyses.id, analysisId), eq(analyses.status, 'running')));
}

export type CandidateSource = {
  pullRequestId: number;
  repositorySlug: string;
  number: number;
  title: string;
  evidence: string;
};

export type LessonCandidateView = LessonCandidateRow & {
  repositorySlug: string;
  sources: CandidateSource[];
  decidedByName: string | null;
};

/** Every candidate with its source PRs, newest first. */
export async function listLessonCandidates(
  db: Executor,
  filter: { ids?: readonly number[] } = {},
): Promise<LessonCandidateView[]> {
  const rows = await db
    .select({
      candidate: lessonCandidates,
      repositorySlug: repositories.slug,
      decidedByName: teamMembers.name,
    })
    .from(lessonCandidates)
    .innerJoin(repositories, eq(repositories.id, lessonCandidates.repositoryId))
    .leftJoin(teamMembers, eq(teamMembers.id, lessonCandidates.decidedByMemberId))
    .where(filter.ids ? inArray(lessonCandidates.id, [...filter.ids]) : undefined)
    .orderBy(desc(lessonCandidates.updatedAt), desc(lessonCandidates.id));
  if (!rows.length) return [];
  const sources = await db
    .select({
      candidateId: lessonCandidateSources.candidateId,
      pullRequestId: lessonCandidateSources.pullRequestId,
      repositorySlug: repositories.slug,
      number: pullRequests.number,
      title: pullRequests.title,
      evidence: lessonCandidateSources.evidence,
    })
    .from(lessonCandidateSources)
    .innerJoin(pullRequests, eq(pullRequests.id, lessonCandidateSources.pullRequestId))
    .innerJoin(repositories, eq(repositories.id, pullRequests.repositoryId))
    .where(
      inArray(
        lessonCandidateSources.candidateId,
        rows.map((r) => r.candidate.id),
      ),
    )
    .orderBy(asc(lessonCandidateSources.id));
  return rows.map((r) => ({
    ...r.candidate,
    repositorySlug: r.repositorySlug,
    decidedByName: r.decidedByName,
    sources: sources
      .filter((s) => s.candidateId === r.candidate.id)
      .map((s) => ({
        pullRequestId: s.pullRequestId,
        repositorySlug: s.repositorySlug,
        number: s.number,
        title: s.title,
        evidence: s.evidence,
      })),
  }));
}

export async function getLessonCandidate(
  db: Executor,
  id: number,
): Promise<LessonCandidateView | null> {
  return (await listLessonCandidates(db, { ids: [id] }))[0] ?? null;
}

/** The candidate's row, locked until the transaction ends. */
export async function lockLessonCandidate(
  tx: Executor,
  id: number,
): Promise<LessonCandidateRow | null> {
  const [row] = await tx
    .select()
    .from(lessonCandidates)
    .where(eq(lessonCandidates.id, id))
    .for('update');
  return row ?? null;
}

/** Edits an open candidate's title and rule, unsigned ("by hand"). Null when it is not open. */
export async function editLessonCandidate(
  db: Executor,
  id: number,
  edit: { title: string; text: string },
): Promise<LessonCandidateRow | null> {
  const now = new Date();
  const [row] = await db
    .update(lessonCandidates)
    .set({ title: edit.title, text: edit.text, editedAt: now, updatedAt: now })
    .where(and(eq(lessonCandidates.id, id), eq(lessonCandidates.status, 'proposed')))
    .returning();
  return row ?? null;
}

/** Rejects an open candidate inside a signed change's transaction. */
export async function rejectLessonCandidate(
  tx: Executor,
  id: number,
  reject: { reason: string; memberId: string },
): Promise<LessonCandidateRow> {
  const now = new Date();
  const [row] = await tx
    .update(lessonCandidates)
    .set({
      status: 'rejected',
      rejectReason: reject.reason,
      decidedByMemberId: reject.memberId,
      decidedAt: now,
      updatedAt: now,
    })
    .where(and(eq(lessonCandidates.id, id), eq(lessonCandidates.status, 'proposed')))
    .returning();
  if (!row) throw new Error(`lesson candidate ${id} is not open`);
  return row;
}

async function lessonsFileOf(tx: Executor, repositoryId: number) {
  return ensureInstructionFile(tx, {
    scope: 'repository',
    repositoryId,
    fileKey: LESSONS_FILE_KEY,
  });
}

async function sourceNumbers(tx: Executor, candidateId: number): Promise<number[]> {
  const rows = await tx
    .select({ number: pullRequests.number })
    .from(lessonCandidateSources)
    .innerJoin(pullRequests, eq(pullRequests.id, lessonCandidateSources.pullRequestId))
    .where(eq(lessonCandidateSources.candidateId, candidateId))
    .orderBy(asc(pullRequests.number));
  return [...new Set(rows.map((r) => r.number))];
}

/** The lessons file's text with this candidate added (core `withLesson`). */
async function lessonsWith(tx: Executor, candidate: LessonCandidateRow, active: string) {
  return withLesson(
    active,
    { title: candidate.title, rule: candidate.text, prs: await sourceNumbers(tx, candidate.id) },
    { placeholder: LESSONS_PLACEHOLDER },
  );
}

export type AcceptedLesson = {
  candidate: LessonCandidateRow;
  fileId: number;
  /** The new active version, created by the bot. */
  version: InstructionVersionRow;
  /** The version it replaced; null when the file had none. */
  previousVersion: number | null;
};

/**
 * Accepts an open candidate inside the signed change's transaction: the lesson is added to its
 * repository's `lessons.md` as a new active version created by the bot (the previous one is
 * archived), the bot logs that version change, and the candidate records the version.
 */
export async function acceptLessonCandidate(
  tx: Executor,
  id: number,
  memberId: string,
): Promise<AcceptedLesson> {
  const candidate = await lockLessonCandidate(tx, id);
  if (candidate?.status !== 'proposed') throw new Error(`lesson candidate ${id} is not open`);
  const file = await lessonsFileOf(tx, candidate.repositoryId);
  const active = await lockActiveInstructionVersion(tx, file.id);
  const content = await lessonsWith(tx, candidate, active?.content ?? '');
  const [{ last }] = (await tx
    .select({ last: max(instructionVersions.version) })
    .from(instructionVersions)
    .where(eq(instructionVersions.fileId, file.id))) as [{ last: number | null }];
  const now = new Date();
  if (active) {
    await tx
      .update(instructionVersions)
      .set({ status: 'archived' })
      .where(eq(instructionVersions.id, active.id));
  }
  const [version] = await tx
    .insert(instructionVersions)
    .values({
      fileId: file.id,
      version: (last ?? 0) + 1,
      status: 'active',
      content,
      note: `Lesson: ${candidate.title}`,
      createdBy: 'bot',
      activatedByMemberId: memberId,
      activatedAt: now,
    })
    .returning();
  await insertSettingsChange(tx, {
    area: 'instructions',
    entity: String(file.id),
    actor: 'bot',
    before: active ? { fileKey: file.fileKey, version: active.version } : null,
    after: {
      fileKey: file.fileKey,
      version: version!.version,
      ...diffSummary(lineDiff(active?.content ?? '', content)),
    },
    note: version!.note,
    at: now,
  });
  const [accepted] = await tx
    .update(lessonCandidates)
    .set({
      status: 'accepted',
      decidedByMemberId: memberId,
      decidedAt: now,
      lessonsVersion: version!.version,
      updatedAt: now,
    })
    .where(eq(lessonCandidates.id, id))
    .returning();
  return {
    candidate: accepted!,
    fileId: file.id,
    version: version!,
    previousVersion: active?.version ?? null,
  };
}

/**
 * "Try on a PR…": the repository's `lessons.md` draft with this candidate added to the active
 * text, saved unsigned ("by hand"). A trial (`POST /api/trials`) then reads it as run B.
 */
export async function lessonDraftOf(
  db: Executor,
  id: number,
): Promise<{ fileId: number; draft: InstructionVersionRow } | null> {
  const [candidate] = await db.select().from(lessonCandidates).where(eq(lessonCandidates.id, id));
  if (candidate?.status !== 'proposed') return null;
  const file = await lessonsFileOf(db, candidate.repositoryId);
  const [active] = await db
    .select()
    .from(instructionVersions)
    .where(and(eq(instructionVersions.fileId, file.id), eq(instructionVersions.status, 'active')));
  const draft = await saveInstructionDraft(db, file.id, {
    content: await lessonsWith(db, candidate, active?.content ?? ''),
    note: `Lesson: ${candidate.title}`,
  });
  return draft ? { fileId: file.id, draft } : null;
}

/** The repository's lessons file id, if it has one. */
export async function lessonsFileIdOf(db: Executor, repositoryId: number): Promise<number | null> {
  const [row] = await db
    .select({ id: instructionFiles.id })
    .from(instructionFiles)
    .where(
      and(
        eq(instructionFiles.scope, 'repository'),
        eq(instructionFiles.repositoryId, repositoryId),
        eq(instructionFiles.fileKey, LESSONS_FILE_KEY),
      ),
    );
  return row?.id ?? null;
}
