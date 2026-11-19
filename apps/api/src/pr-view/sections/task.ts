// S-06-T4: the PR's ClickUp task for the task panel on the PR page: the linked task, or whether
// the repository has ClickUp at all.
import { ACTOR_KINDS } from '@pra/core';
import { getTaskLink, readRepositoryConfig, TASK_LINK_HOWS, type PrTaskLink } from '@pra/db';
import { z } from 'zod/v4';
import { defineSection } from '../section.ts';

export const TaskLinkViewSchema = z.object({
  /** As ClickUp knows it: a custom id such as `WB-123`, or the task's own id. */
  taskId: z.string(),
  name: z.string(),
  url: z.string(),
  how: z.enum(TASK_LINK_HOWS),
  linkedBy: z.enum(ACTOR_KINDS),
});

export const TaskSectionSchema = z.object({
  /** The repository has ClickUp settings (a workspace). */
  configured: z.boolean(),
  link: TaskLinkViewSchema.nullable(),
});

export const taskLinkView = (link: PrTaskLink): z.output<typeof TaskLinkViewSchema> => ({
  taskId: link.taskId,
  name: link.name,
  url: link.url,
  how: link.how,
  linkedBy: link.linkedBy,
});

export const taskSection = defineSection({
  key: 'task',
  schema: TaskSectionSchema,
  async build({ db, repository, pullRequest }) {
    const link = await getTaskLink(db, pullRequest.id);
    return {
      configured: readRepositoryConfig(repository).value.clickup !== null,
      link: link ? taskLinkView(link) : null,
    };
  },
});
