import {
  INSTRUCTION_KINDS,
  INSTRUCTION_SCOPES,
  instructionFileKeyProblem,
  LEVEL_NUMBERS,
  type InstructionKind,
  type LevelNumber,
} from '@pra/core';
import {
  allStageFileChoices,
  createInstructionFile,
  discardInstructionDraft,
  getInstructionFile,
  getInstructionVersion,
  getRepositoryBySlug,
  instructionFileVersions,
  listInstructionFiles,
  listRepositories,
  saveInstructionDraft,
  startInstructionCopy,
  type InstructionFileSummary,
  type InstructionFileWithRepository,
  type InstructionVersionDetail,
} from '@pra/db';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import {
  InstructionGapSchema,
  repositoryInstructionGaps,
} from '../../../pr-view/sections/instruction-gaps.ts';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import { instructionsStore } from '../../../settings/instructions-store.ts';
import { applySignedSettingsChange } from '../../../settings/signed-change.ts';
import { ReadBySchema, readersOfFiles, type ReadBy } from '../../../settings/stage-files.ts';

const VERSION_STATUSES = ['active', 'draft', 'archived'] as const;

export const InstructionFileSchema = z.object({
  id: z.number().int(),
  scope: z.enum(INSTRUCTION_SCOPES),
  /** The repository of a repository copy. */
  repository: z.object({ id: z.number().int(), slug: z.string() }).nullable(),
  /** The level of a level copy. */
  level: z.number().int().nullable(),
  fileKey: z.string(),
  /** Instruction (prompts, rules) or document (reference material), STAGEFILES. */
  kind: z.enum(INSTRUCTION_KINDS),
  /** The stages that read it, per repository for overrides (empty: not used by any stage). */
  readBy: z.array(ReadBySchema),
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
  /** Connected repositories, by slug: where New file can put a repository file (STAGEFILES). */
  repositories: z.array(z.object({ id: z.number().int(), slug: z.string() })),
  /** Connected repositories whose runs would miss required files (INSTR), by slug. */
  gaps: z.array(
    z.object({
      repository: z.object({ id: z.number().int(), slug: z.string() }),
      gaps: z.array(InstructionGapSchema),
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

/** New file (STAGEFILES): a global or repository file whose version 1 is an unsigned draft. */
const NewFileBody = z.object({
  fileKey: z.string().trim(),
  kind: z.enum(INSTRUCTION_KINDS),
  scope: z.enum(['global', 'repository']),
  /** The repository's slug, for `scope: 'repository'`. */
  repository: z.string().trim().optional(),
  content: z.string(),
  note: z.string().trim().max(500).nullable().optional(),
});

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

/**
 * Instructions in Settings (S-22-T4, FR-079): files by scope with their versions. A draft is saved
 * unsigned ("by hand") and changes nothing; activate ("Make active") is signed and logged through
 * `applySignedSettingsChange`, and only changes runs that start afterwards.
 */
const instructions: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get('/', { schema: { response: { 200: InstructionsListResponse } } }, async () => {
    const files = await listInstructionFiles(db);
    const repositories = (await listRepositories(db)).toSorted((a, b) =>
      a.slug.localeCompare(b.slug),
    );
    const gaps = await Promise.all(
      repositories.map(async (r) => ({
        repository: { id: r.id, slug: r.slug },
        gaps: await repositoryInstructionGaps(db, r.id),
      })),
    );
    const readers = await readersByFile(files);
    return {
      files: files.map((f) => ({
        ...fileView(f, readers.get(f.id) ?? []),
        active: f.active && versionRef(f.active),
        draft: f.draft && versionRef(f.draft),
      })),
      repositories: repositories.map((r) => ({ id: r.id, slug: r.slug })),
      gaps: gaps.filter((g) => g.gaps.length > 0),
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

  fastify.post(
    '/:id/activate',
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
      // "Make active" (STAGEFILES) takes any version that is not active: the draft or an archived
      // one, whether it was active before or not.
      if (target.status === 'active') {
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

  fastify.post(
    '/',
    {
      schema: {
        body: NewFileBody,
        response: { 201: InstructionDetailResponse, ...errors },
      },
    },
    async (request, reply) => {
      const { fileKey, kind, scope, content, note } = request.body;
      const problem = instructionFileKeyProblem(fileKey);
      if (problem) {
        return sendError(reply, 400, ApiErrorCode.InstructionFileKey, { problem });
      }
      let ref:
        | { scope: 'global'; fileKey: string }
        | {
            scope: 'repository';
            repositoryId: number;
            fileKey: string;
          } = { scope: 'global', fileKey };
      if (scope === 'repository') {
        const slug = request.body.repository ?? '';
        const repository = slug ? await getRepositoryBySlug(db, slug) : null;
        if (!repository) return sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { slug });
        ref = { scope: 'repository', repositoryId: repository.id, fileKey };
      }
      const created = await db.transaction((tx) =>
        createInstructionFile(tx, { ...ref, kind }, { content, note: note || null }),
      );
      if (!created.ok) {
        return created.reason === 'exists'
          ? sendError(reply, 409, ApiErrorCode.InstructionFileExists, { fileId: created.fileId })
          : sendError(reply, 409, ApiErrorCode.InstructionKindConflict, { kind: created.kind });
      }
      reply.code(201);
      return detail(reply, created.file.id);
    },
  );

  fastify.delete(
    '/:id/draft',
    {
      schema: {
        params: FileParams,
        response: { 200: InstructionDetailResponse, 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!(await getInstructionFile(db, id))) return fileNotFound(reply, id);
      const discarded = await db.transaction((tx) => discardInstructionDraft(tx, id));
      if (!discarded) {
        return sendError(reply, 404, ApiErrorCode.InstructionVersionNotFound, { status: 'draft' });
      }
      // The file's only version went, and the file with it.
      if (discarded === 'file_removed') return reply.code(204).send(null);
      return detail(reply, id);
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
    const readers = await readersByFile();
    return { file: fileView(file, readers.get(id) ?? []), versions: versions.map(versionView) };
  }

  /** "Read by" of every file (STAGEFILES), from the stored stage-file choices. */
  async function readersByFile(files?: InstructionFileSummary[]) {
    const [all, choices, repositories] = await Promise.all([
      files ?? listInstructionFiles(db),
      allStageFileChoices(db),
      listRepositories(db),
    ]);
    return readersOfFiles(all, choices, new Map(repositories.map((r) => [r.id, r.slug])));
  }
};

function fileView(file: InstructionFileWithRepository, readBy: ReadBy[]) {
  return {
    id: file.id,
    scope: file.scope,
    repository:
      file.repositoryId !== null && file.repositorySlug !== null
        ? { id: file.repositoryId, slug: file.repositorySlug }
        : null,
    level: file.level,
    fileKey: file.fileKey,
    kind: file.kind as InstructionKind,
    readBy,
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
