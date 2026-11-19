import { INSTRUCTION_SCOPES, LEVEL_NUMBERS, type LevelNumber } from '@pra/core';
import {
  getInstructionFile,
  getInstructionVersion,
  getRepositoryBySlug,
  instructionFileVersions,
  listInstructionFiles,
  saveInstructionDraft,
  startInstructionCopy,
  type InstructionFileWithRepository,
  type InstructionVersionDetail,
} from '@pra/db';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { instructionsStore } from '../../../settings/instructions-store.ts';
import { applySignedSettingsChange } from '../../../settings/signed-change.ts';

const VERSION_STATUSES = ['active', 'draft', 'archived'] as const;

export const InstructionFileSchema = z.object({
  id: z.number().int(),
  scope: z.enum(INSTRUCTION_SCOPES),
  /** The repository of a repository copy. */
  repository: z.object({ id: z.number().int(), slug: z.string() }).nullable(),
  /** The level of a level copy. */
  level: z.number().int().nullable(),
  fileKey: z.string(),
});

const VersionRefSchema = z.object({
  id: z.number().int(),
  version: z.number().int(),
  note: z.string().nullable(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
});

export const InstructionsListResponse = z.object({
  files: z.array(
    InstructionFileSchema.extend({
      active: VersionRefSchema.nullable(),
      draft: VersionRefSchema.nullable(),
    }),
  ),
});

export const InstructionVersionSchema = VersionRefSchema.extend({
  status: z.enum(VERSION_STATUSES),
  content: z.string(),
  /** `hand` for an unsigned draft, `bot` for the import, `member` with `authorName`. */
  author: z.enum(['member', 'bot', 'hand']),
  authorName: z.string().nullable(),
  /** Who signed the activation that made it active (the latest one). */
  signerName: z.string().nullable(),
  runCount: z.number().int(),
  /** The runs that read it, newest first (at most 20; `runCount` has the total). */
  runs: z.array(
    z.object({
      runId: z.number().int(),
      kind: z.string(),
      repositorySlug: z.string(),
      prNumber: z.number().int(),
      createdAt: z.string(),
    }),
  ),
});

export const InstructionDetailResponse = z.object({
  file: InstructionFileSchema,
  /** Newest first. */
  versions: z.array(InstructionVersionSchema),
});

const FileParams = z.object({ id: z.coerce.number().int().positive() });
const DraftBody = z.object({
  content: z.string(),
  note: z.string().trim().max(500).nullable().optional(),
});
const ActivateBody = z.object({
  versionId: z.number().int().positive(),
  /** The active version number the signer saw; another one gives 409 `settings_stale`. */
  activeVersion: z.number().int().nullable().optional(),
  signedBy: z.string().trim().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
const CopyBody = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('repository'), repository: z.string().trim().min(1) }),
  z.object({ scope: z.literal('level'), level: z.union(LEVEL_NUMBERS.map((n) => z.literal(n))) }),
]);

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

/**
 * Instructions in Settings (S-22-T4, FR-079): files by scope with their versions. A draft is saved
 * unsigned ("by hand") and changes nothing; activate and rollback are signed and logged through
 * `applySignedSettingsChange`, and only change runs that start afterwards.
 */
const instructions: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get('/', { schema: { response: { 200: InstructionsListResponse } } }, async () => {
    const files = await listInstructionFiles(db);
    return {
      files: files.map((f) => ({
        ...fileView(f),
        active: f.active && versionRef(f.active),
        draft: f.draft && versionRef(f.draft),
      })),
    };
  });

  fastify.get(
    '/:id',
    {
      schema: {
        params: FileParams,
        response: { 200: InstructionDetailResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => detail(reply, request.params.id),
  );

  fastify.put(
    '/:id/draft',
    {
      schema: {
        params: FileParams,
        body: DraftBody,
        response: { 200: InstructionDetailResponse, ...errors },
      },
    },
    async (request, reply) => {
      const { content, note } = request.body;
      const saved = await db.transaction((tx) =>
        saveInstructionDraft(tx, request.params.id, { content, note: note || null }),
      );
      if (!saved) return fileNotFound(reply, request.params.id);
      return detail(reply, request.params.id);
    },
  );

  for (const action of ['activate', 'rollback'] as const) {
    fastify.post(
      `/:id/${action}`,
      {
        schema: {
          params: FileParams,
          body: ActivateBody,
          response: { 200: InstructionDetailResponse, ...errors },
        },
      },
      async (request, reply) => {
        const { id } = request.params;
        const file = await getInstructionFile(db, id);
        if (!file) return fileNotFound(reply, id);
        const { versionId, activeVersion, signedBy, note } = request.body;
        const target = await getInstructionVersion(db, versionId);
        if (!target || target.fileId !== id) {
          return sendError(reply, 404, ApiErrorCode.InstructionVersionNotFound, { versionId });
        }
        // Activate takes the draft; rollback re-activates a version that was active before.
        const wanted = action === 'activate' ? 'draft' : 'archived';
        if (target.status !== wanted) {
          return sendError(reply, 409, ApiErrorCode.InstructionVersionStatus, {
            status: target.status,
          });
        }
        const store = instructionsStore(signedBy || null);
        const current = activeVersion === undefined ? await currentActive(id) : activeVersion;
        const result = await applySignedSettingsChange(db, {
          store,
          entity: String(id),
          before: { fileKey: file.fileKey, version: current },
          after: { fileKey: file.fileKey, version: target.version },
          signer: signedBy,
          note: note || target.note,
        });
        if (!result.ok) return sendError(reply, result.status, result.code, result.params);
        return detail(reply, id);
      },
    );
  }

  fastify.post(
    '/:id/copies',
    {
      schema: {
        params: FileParams,
        body: CopyBody,
        response: { 201: InstructionDetailResponse, ...errors },
      },
    },
    async (request, reply) => {
      const source = await getInstructionFile(db, request.params.id);
      if (!source) return fileNotFound(reply, request.params.id);
      const body = request.body;
      let target:
        { scope: 'repository'; repositoryId: number } | { scope: 'level'; level: LevelNumber };
      if (body.scope === 'repository') {
        const repository = await getRepositoryBySlug(db, body.repository);
        if (!repository) {
          return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { slug: body.repository });
        }
        target = { scope: 'repository', repositoryId: repository.id };
      } else {
        target = { scope: 'level', level: body.level };
      }
      const copy = await startInstructionCopy(db, source, target);
      if (!copy.ok) {
        return copy.reason === 'exists'
          ? sendError(reply, 409, ApiErrorCode.InstructionCopyExists, { fileKey: source.fileKey })
          : sendError(reply, 409, ApiErrorCode.InstructionNoActive, { fileId: source.id });
      }
      reply.code(201);
      return detail(reply, copy.file.id);
    },
  );

  async function currentActive(fileId: number): Promise<number | null> {
    const versions = await instructionFileVersions(db, fileId);
    return versions.find((v) => v.status === 'active')?.version ?? null;
  }

  async function detail(reply: FastifyReply, id: number) {
    const file = await getInstructionFile(db, id);
    if (!file) return fileNotFound(reply, id);
    const versions = await instructionFileVersions(db, id);
    return { file: fileView(file), versions: versions.map(versionView) };
  }
};

function fileView(file: InstructionFileWithRepository) {
  return {
    id: file.id,
    scope: file.scope,
    repository:
      file.repositoryId !== null && file.repositorySlug !== null
        ? { id: file.repositoryId, slug: file.repositorySlug }
        : null,
    level: file.level,
    fileKey: file.fileKey,
  };
}

function versionRef(v: {
  id: number;
  version: number;
  note: string | null;
  createdAt: Date;
  activatedAt: Date | null;
}) {
  return {
    id: v.id,
    version: v.version,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
    activatedAt: v.activatedAt?.toISOString() ?? null,
  };
}

function versionView(v: InstructionVersionDetail) {
  return {
    ...versionRef(v),
    status: v.status,
    content: v.content,
    author: v.createdBy,
    authorName: v.createdByName,
    signerName: v.activatedByName,
    runCount: v.runCount,
    runs: v.runs.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
  };
}

const fileNotFound = (reply: FastifyReply, id: number) =>
  sendError(reply, 404, ApiErrorCode.InstructionFileNotFound, { id });

export default instructions;
