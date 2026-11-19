// Learning (S-23-T1): the analyst's runs on closed PRs and the lesson candidates they propose. A
// candidate becomes a lesson only when a person accepts it, signed, into its repository's
// `lessons.md`.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { pullRequests, repositories } from './repositories.ts';
import { runs } from './runs.ts';
import { teamMembers } from './team.ts';

/** `running` from the start until the run ends (a paused queue keeps it waiting as running). */
export const ANALYSIS_STATUSES = ['running', 'finished', 'failed'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];
/** Core `CandidateStatus`: `proposed` is an open candidate. */
export const CANDIDATE_STATUSES = ['proposed', 'accepted', 'rejected'] as const;
/** The bot starts one analysis when a level 6 PR closes; a person may start more, by hand. */
export const ANALYSIS_STARTERS = ['bot', 'hand'] as const;

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** One analyst run on one closed PR. */
export const analyses = pgTable(
  'analyses',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** The run of kind `analyst`; set in the run's insert transaction. */
    runId: integer('run_id').references(() => runs.id, { onDelete: 'set null' }),
    startedBy: text('started_by', { enum: ANALYSIS_STARTERS }).notNull(),
    status: text({ enum: ANALYSIS_STATUSES }).notNull().default('running'),
    /** Candidates the analysis created or added its PR to; set when it finishes. */
    candidateCount: integer('candidate_count'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('analyses_pull_request').on(t.pullRequestId, t.createdAt),
    uniqueIndex('analyses_run').on(t.runId),
    // The bot analyses a PR once, however many `closed` deliveries arrive.
    uniqueIndex('analyses_one_by_bot')
      .on(t.pullRequestId)
      .where(sql`${t.startedBy} = 'bot'`),
    check('analyses_started_by', sql`${t.startedBy} in ('bot', 'hand')`),
    check('analyses_status', sql`${t.status} in ('running', 'finished', 'failed')`),
  ],
);

/** A lesson the analyst proposed for one repository's `lessons.md`. */
export const lessonCandidates = pgTable(
  'lesson_candidates',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    /** The rule for the reviewer; a person may edit it (unsigned) before accepting. */
    text: text().notNull(),
    /** Why, in the analyst's words, from the PR that created the candidate. */
    evidence: text().notNull().default(''),
    status: text({ enum: CANDIDATE_STATUSES }).notNull().default('proposed'),
    /** Distinct PRs in `lesson_candidate_sources`, kept in step with them. */
    prCount: integer('pr_count').notNull().default(1),
    rejectReason: text('reject_reason'),
    /** Who signed the accept or the reject. */
    decidedByMemberId: uuid('decided_by_member_id').references(() => teamMembers.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** The `lessons.md` version the accept created. */
    lessonsVersion: integer('lessons_version'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lesson_candidates_repository').on(t.repositoryId, t.status),
    check('lesson_candidates_status', sql`${t.status} in ('proposed', 'accepted', 'rejected')`),
    check(
      'lesson_candidates_reject_reason',
      sql`${t.status} <> 'rejected' or ${t.rejectReason} is not null`,
    ),
  ],
);

/** A PR a candidate came from, and the analysis that saw it there. */
export const lessonCandidateSources = pgTable(
  'lesson_candidate_sources',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    candidateId: integer('candidate_id')
      .notNull()
      .references(() => lessonCandidates.id, { onDelete: 'cascade' }),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    analysisId: integer('analysis_id').references(() => analyses.id, { onDelete: 'set null' }),
    evidence: text().notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => [
    // The same PR never counts twice for one candidate.
    unique('lesson_candidate_sources_pr').on(t.candidateId, t.pullRequestId),
    index('lesson_candidate_sources_analysis').on(t.analysisId),
  ],
);
