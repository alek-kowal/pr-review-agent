import { ACTOR_KINDS } from '@pra/core';
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { pullRequests } from './repositories.ts';

/** How a PR got its ClickUp task: its branch, its title, the search fallback, or a person. */
export const TASK_LINK_HOWS = ['branch', 'title', 'search', 'hand'] as const;
export type TaskLinkHow = (typeof TASK_LINK_HOWS)[number];

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** The ClickUp task a pull request implements; at most one per PR. */
export const prTaskLinks = pgTable(
  'pr_task_links',
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    pullRequestId: integer('pull_request_id')
      .notNull()
      .unique()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    /** As ClickUp knows it: a custom id such as `WB-123`, or the task's own id. */
    taskId: text('task_id').notNull(),
    url: text().notNull(),
    name: text().notNull(),
    how: text({ enum: TASK_LINK_HOWS }).notNull(),
    linkedBy: text('linked_by', { enum: ACTOR_KINDS }).notNull(),
    linkedByMemberId: text('linked_by_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('pr_task_links_how', sql`${t.how} in (${list(TASK_LINK_HOWS)})`),
    check('pr_task_links_linked_by', sql`${t.linkedBy} in (${list(ACTOR_KINDS)})`),
    check(
      'pr_task_links_linked_by_member',
      sql`(${t.linkedBy} = 'member') = (${t.linkedByMemberId} is not null)`,
    ),
  ],
);
