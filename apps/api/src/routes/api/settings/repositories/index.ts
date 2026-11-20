import { RepositoryConfigSchema, type RepositoryConfig } from '@pra/core';
import {
  getRepository,
  isUniqueViolation,
  listRepositories,
  readRepositoryConfig,
  type Repository,
} from '@pra/db';
import {
  GITHUB_NOT_CONFIGURED,
  GITHUB_RATE_LIMITED,
  type AccessibleRepository,
} from '@pra/integrations';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../../plugins/errors.ts';
import { repositoryStore } from '../../../../settings/repository-store.ts';
import {
  applySignedSettingsChange,
  NEW_ENTITY,
  type SignedSettingsChangeInput,
} from '../../../../settings/signed-change.ts';

/** Every RepositoryConfig field a person sets; slug and full name come from GitHub. */
export const RepositorySettingsSchema = RepositoryConfigSchema.omit({
  slug: true,
  githubFullName: true,
});

export const ConnectedRepositorySchema = z.object({
  id: z.number().int(),
  slug: z.string(),
  githubFullName: z.string(),
  installationId: z.number().int().nullable(),
  config: RepositoryConfigSchema,
});
export const AvailableRepositorySchema = z.object({
  fullName: z.string(),
  installationId: z.number().int(),
  account: z.string(),
  defaultBranch: z.string(),
  private: z.boolean(),
});
export const RepositoriesSettingsResponse = z.object({
  repositories: z.array(ConnectedRepositorySchema),
  /** Repositories the App can reach that are not connected yet. */
  available: z.array(AvailableRepositorySchema),
  /** Why `available` could not be listed (e.g. `github_not_configured`); null when it was. */
  availableError: z
    .object({ code: z.string(), params: z.record(z.string(), z.unknown()) })
    .nullable(),
});
export const RepositorySettingsResponse = z.object({ repository: ConnectedRepositorySchema });

const SignedBy = z.string().trim().optional();
const ConnectBody = z.object({
  fullName: z.string().trim().min(1),
  config: RepositorySettingsSchema,
  signedBy: SignedBy,
});
const EditBody = z.object({
  config: RepositorySettingsSchema,
  /** The config the signer saw; when sent, a change made in between gives 409 `settings_stale`. */
  before: z.record(z.string(), z.unknown()).optional(),
  signedBy: SignedBy,
});
const RepositoryParams = z.object({ id: z.coerce.number().int().positive() });

/** `owner/name` as GitHub allows it. */
const REPOSITORY_NAME = /^[\w.-]+\/[\w.-]+$/;
const LookupQuery = z.object({ fullName: z.string().trim().min(1) });
export const LookupResponse = z.object({
  repository: z.object({ fullName: z.string(), defaultBranch: z.string(), private: z.boolean() }),
});

const errors = {
  400: ApiErrorSchema,
  404: ApiErrorSchema,
  409: ApiErrorSchema,
  503: ApiErrorSchema,
};

/**
 * Repositories in Settings (S-20-T3, FR-077): connect any repository the GitHub App can reach and
 * edit its RepositoryConfig. Every write is signed and logged through `applySignedSettingsChange`.
 * The worker looks a repository up on every event, so a new one needs no restart.
 */
const repositories: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db, github } = fastify.deps;

  /** The repository by name as GitHub shows it to the token (or to anyone); no installation. */
  async function reachableByName(fullName: string) {
    if (!REPOSITORY_NAME.test(fullName)) return undefined;
    const found = await github.getRepository(fullName);
    return found ? { fullName: found.fullName, installationId: null } : undefined;
  }

  fastify.get('/', { schema: { response: { 200: RepositoriesSettingsResponse } } }, async () => {
    const connected = await listRepositories(db);
    const names = new Set(connected.map((r) => r.githubFullName.toLowerCase()));
    let available: AccessibleRepository[] = [];
    let availableError: { code: string; params: Record<string, unknown> } | null = null;
    try {
      available = (await github.listAccessibleRepositories()).filter(
        (r) => !names.has(r.fullName.toLowerCase()),
      );
    } catch (error) {
      availableError = integrationError(error);
    }
    return { repositories: connected.map(connectedRepository), available, availableError };
  });

  /**
   * Without the App (P-28) the connect form takes `owner/name`: one GET checks that GitHub shows
   * the repository (public, or reachable with `GITHUB_TOKEN`) and gives its default branch to
   * prefill. 404 `repository_not_reachable`; 409 when it is connected already.
   */
  fastify.get(
    '/lookup',
    {
      schema: {
        querystring: LookupQuery,
        response: { 200: LookupResponse, ...errors, 429: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const fullName = request.query.fullName;
      if (!REPOSITORY_NAME.test(fullName)) {
        return sendError(reply, 404, ApiErrorCode.RepositoryNotReachable, { fullName });
      }
      const connected = await listRepositories(db);
      if (connected.some((r) => r.githubFullName.toLowerCase() === fullName.toLowerCase())) {
        return sendError(reply, 409, ApiErrorCode.RepositoryAlreadyConnected, { fullName });
      }
      try {
        const found = await github.getRepository(fullName);
        if (!found) return sendError(reply, 404, ApiErrorCode.RepositoryNotReachable, { fullName });
        return { repository: found };
      } catch (error) {
        const failure = integrationError(error);
        if (failure.code === GITHUB_RATE_LIMITED) {
          return sendError(reply, 429, ApiErrorCode.GithubRateLimited, failure.params);
        }
        throw error;
      }
    },
  );

  fastify.post(
    '/',
    { schema: { body: ConnectBody, response: { 201: RepositorySettingsResponse, ...errors } } },
    async (request, reply) => {
      const { fullName, config, signedBy } = request.body;
      let target: { fullName: string; installationId: number | null } | undefined;
      try {
        target =
          github.mode === 'app'
            ? (await github.listAccessibleRepositories()).find(
                (r) => r.fullName.toLowerCase() === fullName.toLowerCase(),
              )
            : // Without the App (P-28) a repository is connected by name: GitHub must show it.
              await reachableByName(fullName);
      } catch (error) {
        const failure = integrationError(error);
        if (failure?.code === GITHUB_NOT_CONFIGURED) {
          return sendError(reply, 503, ApiErrorCode.GithubNotConfigured, failure.params);
        }
        throw error;
      }
      if (!target) return sendError(reply, 404, ApiErrorCode.RepositoryNotReachable, { fullName });

      const connected = await listRepositories(db);
      if (connected.some((r) => r.githubFullName.toLowerCase() === fullName.toLowerCase())) {
        return sendError(reply, 409, ApiErrorCode.RepositoryAlreadyConnected, { fullName });
      }
      const after: RepositoryConfig = {
        ...config,
        slug: slugFor(target.fullName, new Set(connected.map((r) => r.slug))),
        githubFullName: target.fullName,
      };
      return apply(reply, 201, {
        store: repositoryStore({ installationId: target.installationId }),
        entity: NEW_ENTITY,
        before: null,
        after,
        signer: signedBy,
      });
    },
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: RepositoryParams,
        response: { 200: RepositorySettingsResponse, 404: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const repository = await getRepository(db, request.params.id);
      if (!repository) return notFound(reply, request.params.id);
      return { repository: connectedRepository(repository) };
    },
  );

  fastify.put(
    '/:id',
    {
      schema: {
        params: RepositoryParams,
        body: EditBody,
        response: { 200: RepositorySettingsResponse, ...errors },
      },
    },
    async (request, reply) => {
      const repository = await getRepository(db, request.params.id);
      if (!repository) return notFound(reply, request.params.id);
      const { config, before, signedBy } = request.body;
      const current = readRepositoryConfig(repository).value;
      return apply(reply, 200, {
        store: repositoryStore(),
        entity: String(repository.id),
        // Only compared with what is stored (`sameJson`), never written.
        before: (before as RepositoryConfig | undefined) ?? current,
        after: { ...config, slug: current.slug, githubFullName: current.githubFullName },
        signer: signedBy,
      });
    },
  );

  /** Applies a signed change and answers with the repository, or the error as a reason code. */
  async function apply(
    reply: FastifyReply,
    status: 200 | 201,
    input: SignedSettingsChangeInput<RepositoryConfig>,
  ) {
    let result;
    try {
      result = await applySignedSettingsChange(db, input);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return sendError(reply, 409, ApiErrorCode.RepositoryAlreadyConnected, {
          fullName: input.after?.githubFullName,
        });
      }
      throw error;
    }
    if (!result.ok) return sendError(reply, result.status, result.code, result.params);
    const repository = await getRepository(db, Number(result.entity));
    return reply.code(status).send({ repository: connectedRepository(repository!) });
  }
};

function connectedRepository(repository: Repository) {
  return {
    id: repository.id,
    slug: repository.slug,
    githubFullName: repository.githubFullName,
    installationId: repository.installationId,
    config: readRepositoryConfig(repository).value,
  };
}

const notFound = (reply: FastifyReply, id: number) =>
  sendError(reply, 404, ApiErrorCode.RepositoryNotFound, { id });

/** An integration error's code and params (by shape: routes load through autoload's import). */
function integrationError(error: unknown): { code: string; params: Record<string, unknown> } {
  const failure = error as { code?: unknown; params?: unknown; missing?: unknown } | null;
  if (typeof failure?.code !== 'string') return { code: 'github_error', params: {} };
  const params =
    failure.params && typeof failure.params === 'object' && !Array.isArray(failure.params)
      ? (failure.params as Record<string, unknown>)
      : { missing: failure.params ?? failure.missing ?? [] };
  return { code: failure.code, params };
}

/** The repository's name as a slug; the owner is added when the name is taken. */
export function slugFor(fullName: string, taken: ReadonlySet<string>): string {
  const clean = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const [owner = '', name = ''] = fullName.split('/');
  const base = clean(name) || 'repository';
  if (!taken.has(base)) return base;
  const owned = clean(`${owner}-${name}`) || base;
  let slug = owned;
  for (let n = 2; taken.has(slug); n++) slug = `${owned}-${n}`;
  return slug;
}

export default repositories;
