// S-18-T5: one alert as the web reads it, in Activity, on the PR page and in the lists. Title,
// next step and end note are reason codes; the web maps them to copy.
import { ALERT_KINDS, ALERT_STATUSES } from '@pra/core';
import { ALERT_DELIVERY_STATUSES, ALERT_ENDERS, type AlertView } from '@pra/db';
import { z } from 'zod/v4';
import { iso, ReasonSchema } from '../pr-view/round.ts';

const timestamp = z.iso.datetime({ offset: true });

export const AlertSchema = z.object({
  id: z.number().int(),
  kind: z.enum(ALERT_KINDS),
  status: z.enum(ALERT_STATUSES),
  title: ReasonSchema,
  nextStep: ReasonSchema,
  /** The failed round (Retry from its stage); null for the other kinds. */
  runId: z.number().int().nullable(),
  /** Null for the daily budget alert. */
  pullRequest: z
    .object({
      repository: z.object({ slug: z.string() }),
      number: z.number().int(),
      title: z.string(),
    })
    .nullable(),
  delivery: z.object({
    status: z.enum(ALERT_DELIVERY_STATUSES),
    /** The ClickUp task the comment goes to; null when there is none. */
    taskId: z.string().nullable(),
    /** True when it goes to the general alerts task. */
    toGeneralTask: z.boolean(),
    postedAt: timestamp.nullable(),
  }),
  createdAt: timestamp,
  endedAt: timestamp.nullable(),
  /** `hand`: dismissed by a person; `bot`: cleared by the rules. */
  endedBy: z.enum(ALERT_ENDERS).nullable(),
  /** Why the bot cleared it (`alert_end_*`). */
  endNote: ReasonSchema.nullable(),
});
export type AlertResponse = z.output<typeof AlertSchema>;

export const alertView = (alert: AlertView): AlertResponse => ({
  id: alert.id,
  kind: alert.kind,
  status: alert.status,
  title: alert.title,
  nextStep: alert.nextStep,
  runId: alert.runId,
  pullRequest: alert.pr
    ? { repository: { slug: alert.pr.repo }, number: alert.pr.number, title: alert.pr.title }
    : null,
  delivery: {
    status: alert.deliveryStatus,
    taskId: alert.clickupTaskId,
    toGeneralTask: alert.toGeneralTask,
    postedAt: iso(alert.postedAt),
  },
  createdAt: alert.createdAt.toISOString(),
  endedAt: iso(alert.endedAt),
  endedBy: alert.endedBy,
  endNote: alert.endNote,
});
