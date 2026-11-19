import { reportError } from '@pra/integrations/observability';
import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';

/** Reason codes the API returns. Clients map them to copy; the API sends no prose. */
export const ApiErrorCode = {
  InvalidRequest: 'invalid_request',
  InternalError: 'internal_error',
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

export function errorBody(code: ApiErrorCode, params: Record<string, unknown> = {}): ApiErrorBody {
  return { error: { code, params } };
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
