import { reportError } from '@pra/integrations/observability';
import fp from 'fastify-plugin';
import type { FastifyError, FastifyReply } from 'fastify';
import { z } from 'zod/v4';

/** Reason codes the API returns. Clients map them to copy; the API sends no prose. */
export const ApiErrorCode = {
  InvalidRequest: 'invalid_request',
  InternalError: 'internal_error',
  RepositoryNotFound: 'repository_not_found',
  /** Connecting a repository the GitHub App cannot reach. */
  RepositoryNotReachable: 'repository_not_reachable',
  /** Connecting a repository that is already connected. */
  RepositoryAlreadyConnected: 'repository_already_connected',
  PrNotFound: 'pr_not_found',
  /** A state-changing request without `X-PRA-Request: 1` and a same-host `Origin` (csrf.ts). */
  CsrfRejected: 'csrf_rejected',
  /** `POST /webhooks/github` without a valid `X-Hub-Signature-256`. */
  WebhookSignatureInvalid: 'webhook_signature_invalid',
  /** The GitHub App env vars are missing (`params.missing` names them). */
  GithubNotConfigured: 'github_not_configured',
  /** A signed action without `signedBy`. */
  SignatureRequired: 'signature_required',
  /** `signedBy` is not an active Team member. */
  SignerUnknown: 'signer_unknown',
  /** A settings save whose `before` is no longer current: someone saved in between. */
  SettingsStale: 'settings_stale',
  TeamMemberNotFound: 'team_member_not_found',
  /** Another active Team member has this GitHub login. */
  GithubLoginTaken: 'github_login_taken',
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
 * - schema validation errors: 400 `invalid_request`, params `{ part, issues: [{ path, code }] }`;
 *   a custom check (a zod `refine`) whose message is a reason code, such as `invalid_glob`,
 *   gives that code instead of `custom`
 * - other client errors (4xx, e.g. malformed JSON): same status, `invalid_request`, no params
 * - anything else: 500 `internal_error`, no params; the error is logged and reported to Sentry
 *   (when SENTRY_DSN is set), never sent to the client
 */
const REASON_CODE = /^[a-z][a-z0-9_]*$/;
const issueCode = (keyword: string, message: string | undefined): string =>
  keyword === 'custom' && message && REASON_CODE.test(message) ? message : keyword;

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
              code: issueCode(issue.keyword, issue.message),
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
