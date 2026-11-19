import { ACTOR_KINDS } from '@pra/core';
import {
  searchSettingsChanges,
  settingsChangeFacets,
  type AuditActorFilter,
  type AuditEntry,
} from '@pra/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorSchema } from '../../../plugins/errors.ts';

const timestamp = z.iso.datetime({ offset: true });
const PAGE_SIZE = 50;

const AuditQuery = z.object({
  /** Searches the area, the entity, the actor and signer, the note and the before/after values. */
  q: z.string().trim().max(200).optional(),
  area: z.string().trim().min(1).optional(),
  /** `bot`, `hand` (unsigned, "by hand"), or a Team member's id (signed by them). */
  actor: z.union([z.literal('bot'), z.literal('hand'), z.uuid()]).optional(),
  /** Inclusive lower bound. */
  from: timestamp.optional(),
  /** Exclusive upper bound. */
  to: timestamp.optional(),
  /** `nextCursor` of the previous page. */
  cursor: z
    .string()
    .regex(/^\d{1,18}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(PAGE_SIZE),
});

const AuditEntrySchema = z.object({
  id: z.number().int(),
  at: timestamp,
  area: z.string(),
  entity: z.string(),
  actor: z.enum(ACTOR_KINDS),
  /** The signer of a `member` change (the name is kept after they leave Team). */
  signer: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** Null when the change created the entity. */
  before: z.unknown(),
  /** Null when the change removed the entity. */
  after: z.unknown(),
  note: z.string().nullable(),
});

const AuditResponse = z.object({
  entries: z.array(AuditEntrySchema),
  /** Pass as `cursor` for the next page; null on the last page. */
  nextCursor: z.string().nullable(),
  /** Every area in the log, and every signer, for the page's filters. */
  areas: z.array(z.string()),
  signers: z.array(z.object({ id: z.string(), name: z.string() })),
});

const actorFilter = (actor: string | undefined): AuditActorFilter | undefined =>
  actor === undefined
    ? undefined
    : actor === 'bot' || actor === 'hand'
      ? { kind: actor }
      : { kind: 'member', id: actor };

const entry = (row: AuditEntry): z.output<typeof AuditEntrySchema> => ({
  id: row.id,
  at: row.at.toISOString(),
  area: row.area,
  entity: row.entity,
  actor: row.actor,
  signer: row.signerId ? { id: row.signerId, name: row.signerName ?? '' } : null,
  before: row.before ?? null,
  after: row.after ?? null,
  note: row.note,
});

/** The Audit log (S-21-T6, FR-082): every settings change, read-only, newest first. */
const audit: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get(
    '/',
    { schema: { querystring: AuditQuery, response: { 200: AuditResponse, 400: ApiErrorSchema } } },
    async (request) => {
      const query = request.query;
      const [page, facets] = await Promise.all([
        searchSettingsChanges(db, {
          q: query.q,
          area: query.area,
          actor: actorFilter(query.actor),
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
          after: query.cursor ? Number(query.cursor) : undefined,
          limit: query.limit,
        }),
        settingsChangeFacets(db),
      ]);
      const last = page.entries.at(-1);
      return {
        entries: page.entries.map(entry),
        nextCursor: page.hasMore && last ? String(last.id) : null,
        ...facets,
      };
    },
  );
};

export default audit;
