import { ACTOR_KINDS } from '@pra/core';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';
import { teamMembers } from './team.ts';

export const SENSITIVE_STATUSES = ['pending', 'approved', 'sent_back'] as const;

/**
 * A changed file of a PR that matches a sensitive pattern of its repository (S-11, FR-046). A
 * completed round adds new matches as pending; a person approves them by hand or sends them back
 * signed, and the next push turns sent back into pending again. `pull_requests.sensitive_version`
 * moves with every change, so a person acts on the set they saw.
 */
export const sensitiveFiles = pgTable(
  'sensitive_files',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    path: text().notNull(),
    /** The first sensitive pattern the path matched, and the repository's reason for it. */
    pattern: text().notNull(),
    reason: text().notNull(),
    status: text({ enum: SENSITIVE_STATUSES }).notNull().default('pending'),
    /** Who set the status: `hand` (approved), `member` (sent back, signed); null while pending. */
    actor: text({ enum: ACTOR_KINDS }),
    memberId: uuid('member_id').references(() => teamMembers.id),
    /** Why it was sent back. */
    comment: text(),
    /** When the status was set. */
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** The PR head when the status was set. */
    headSha: text('head_sha').notNull(),
  },
  (t) => [
    unique('sensitive_files_pull_request_path').on(t.pullRequestId, t.path),
    check('sensitive_files_status', sql`${t.status} in ('pending', 'approved', 'sent_back')`),
    check('sensitive_files_member', sql`(${t.actor} = 'member') = (${t.memberId} is not null)`),
  ],
);
