// S-08: answers to the reviewer's questions, signed opinions on findings and signed reviews.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { findings, questions } from './runs.ts';
import { teamMembers } from './team.ts';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * An answer to one question (S-08-T1, FR-034). Answers saved together share one signature and one
 * `saved_at`. Saving again over a question adds a row; its newest row is its answer, so an older
 * answer stays on record.
 */
export const answers = pgTable(
  'answers',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    questionId: integer('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** The picked option's index; null for an own answer. */
    option: integer(),
    /** The picked option's text, or the own answer. */
    text: text().notNull(),
    signedBy: uuid('signed_by')
      .notNull()
      .references(() => teamMembers.id),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('answers_question').on(t.questionId, t.id),
    index('answers_pull_request').on(t.pullRequestId),
  ],
);

export const OPINIONS = ['worth', 'not_worth'] as const;
export type OpinionValue = (typeof OPINIONS)[number];

/**
 * One signed review: opinions on one or many findings saved together (S-08-T4, FR-038). The
 * counts are kept as saved, for "Tomek's review: 2 worth implementing, 1 not worth it". Notify
 * author posts once per review (S-08-T10).
 */
export const reviews = pgTable(
  'reviews',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    signedBy: uuid('signed_by')
      .notNull()
      .references(() => teamMembers.id),
    worth: integer().notNull(),
    notWorth: integer('not_worth').notNull(),
    createdAt: createdAt(),
    /** When Notify author posted the ClickUp comment; null until then. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notifiedTaskId: text('notified_task_id'),
  },
  (t) => [index('reviews_pull_request').on(t.pullRequestId, t.createdAt)],
);

/**
 * A signed opinion on a finding (S-08-T4, FR-037): one per signer and finding, so a signer's newer
 * opinion replaces only their own. A carried opinion is a copy on the matching finding of a later
 * round (S-08-T7, FR-043): `carried_from_id` is the opinion it copies and `from_round` the round
 * it was first given in.
 */
export const opinions = pgTable(
  'opinions',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    findingId: integer('finding_id')
      .notNull()
      .references(() => findings.id, { onDelete: 'cascade' }),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    signedBy: uuid('signed_by')
      .notNull()
      .references(() => teamMembers.id),
    value: text({ enum: OPINIONS }).notNull(),
    comment: text(),
    /** The review that saved it; a carried opinion keeps its original's review. */
    reviewId: integer('review_id').references(() => reviews.id, { onDelete: 'set null' }),
    /** The round number the opinion was given in. */
    fromRound: integer('from_round').notNull(),
    carriedFromId: integer('carried_from_id').references((): AnyPgColumn => opinions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('opinions_finding_signer').on(t.findingId, t.signedBy),
    index('opinions_pull_request').on(t.pullRequestId),
    check('opinions_value', sql`${t.value} in ('worth', 'not_worth')`),
  ],
);
