import { reportError } from '@pra/integrations/observability';
import fp from 'fastify-plugin';
import type { FastifyError, FastifyReply } from 'fastify';
import { z } from 'zod/v4';

/** Reason codes the API returns. Clients map them to copy; the API sends no prose. */
export const ApiErrorCode = {
  InvalidRequest: 'invalid_request',
  InternalError: 'internal_error',
  RepositoryNotFound: 'repository_not_found',
  PrNotFound: 'pr_not_found',
  /** A state-changing request without `X-PRA-Request: 1` and a same-host `Origin` (csrf.ts). */
  CsrfRejected: 'csrf_rejected',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export type ApiErrorBody = {
  error: {
    code: ApiErrorCode;
    params: Record<string, unknown>;
  };
};

/** The error shape for route schemas (OpenAPI), for example `{ 404: ApiErrorSchema }`. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(Object.values(ApiErrorCode) as [ApiErrorCode, ...ApiErrorCode[]]),
    params: z.record(z.string(), z.unknown()),
  }),
});

export function errorBody(code: ApiErrorCode, params: Record<string, unknown> = {}): ApiErrorBody {
  return { error: { code, params } };
}

/** Sends `{ error: { code, params } }` with the given status. */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  params: Record<string, unknown> = {},
) {
  return reply.code(statusCode).send(errorBody(code, params));
}

/**
 * The one error handler. Every error leaves the API as `{ error: { code, params } }`:
 * - schema validation errors: 400 `invalid_request`, params `{ part, issues: [{ path, code }] }`
 * - other client errors (4xx, e.g. malformed JSON): same status, `invalid_request`, no params
 * - anything else: 500 `internal_error`, no params; the error is logged and reported to Sentry
 *   (when SENTRY_DSN is set), never sent to the client
 */
export default fp(
  async (fastify) => {
    fastify.setErrorHandler<FastifyError>(async (error, request, reply) => {
      if (error.validation) {
        request.log.info({ err: error }, 'request validation failed');
        return reply.code(400).send(
          errorBody(ApiErrorCode.InvalidRequest, {
            part: error.validationContext,
            issues: error.validation.map((issue) => ({
              path: issue.instancePath,
              code: issue.keyword,
            })),
          }),
        );
      }

      const statusCode = error.statusCode ?? 500;
      if (statusCode >= 400 && statusCode < 500) {
        request.log.info({ err: error }, 'client error');
        return reply.code(statusCode).send(errorBody(ApiErrorCode.InvalidRequest));
      }

      request.log.error({ err: error }, 'unexpected error');
      reportError(error, { method: request.method, route: request.routeOptions.url });
      return reply.code(500).send(errorBody(ApiErrorCode.InternalError));
    });
  },
  { name: 'errors' },
);
