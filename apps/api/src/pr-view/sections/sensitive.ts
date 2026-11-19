// S-11-T2: the PR's sensitive files (FR-046): each file with the pattern it matched and its
// status, the version a person approves or sends back, and who sent them back with what comment.
import { getTeamMember, schema } from '@pra/db';
import { z } from 'zod/v4';
import { defineSection } from '../section.ts';
import { prStateOf } from '../state.ts';

const { SENSITIVE_STATUSES } = schema;

export const SensitiveSchema = z.object({
  /** Send it back with approve or send back; a stale one answers 409 `sensitive_stale`. */
  version: z.number().int(),
  /** The PR's status as core sees it; null when no file matched. */
  status: z.enum(SENSITIVE_STATUSES).nullable(),
  files: z.array(
    z.object({
      path: z.string(),
      pattern: z.string(),
      /** The repository setting's explanation. */
      reason: z.string(),
      status: z.enum(SENSITIVE_STATUSES),
    }),
  ),
  /** The latest send back while any file is still sent back. */
  sentBack: z
    .object({
      by: z.object({ id: z.string(), name: z.string() }),
      comment: z.string(),
      at: z.iso.datetime({ offset: true }),
    })
    .nullable(),
});

export const sensitiveSection = defineSection({
  key: 'sensitive',
  schema: SensitiveSchema,
  async build(context) {
    const load = await prStateOf(context);
    const rows = load.sensitiveFiles;
    const sent = rows
      .filter((row) => row.status === 'sent_back' && row.memberId)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    const signer = sent?.memberId ? await getTeamMember(context.db, sent.memberId) : undefined;
    return {
      version: load.pullRequest.sensitiveVersion,
      status: load.input.sensitive?.status ?? null,
      files: rows.map(({ path, pattern, reason, status }) => ({ path, pattern, reason, status })),
      sentBack:
        sent && signer
          ? {
              by: { id: signer.id, name: signer.name },
              comment: sent.comment ?? '',
              at: sent.at.toISOString(),
            }
          : null,
    };
  },
});
