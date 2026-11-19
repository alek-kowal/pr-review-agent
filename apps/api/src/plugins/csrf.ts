import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ApiErrorCode, errorBody } from './errors.ts';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Called by GitHub, not a browser; it proves itself with the webhook signature instead. */
const EXEMPT_PATHS = new Set(['/webhooks/github']);

/**
 * CSRF guard (tech-stack.md flag 7). A state-changing request must carry `X-PRA-Request: 1`
 * (a custom header a cross-site form cannot send) and an `Origin` whose host equals the
 * request's host. `request.host` follows `X-Forwarded-Host` only from a trusted proxy
 * (`TRUST_PROXY`). Anything else gets 403 `csrf_rejected` before routing or body parsing.
 */
export default fp(
  async (fastify) => {
    fastify.addHook('onRequest', async (request, reply) => {
      if (!STATE_CHANGING.has(request.method)) return;
      if (EXEMPT_PATHS.has(pathOf(request.url))) return;
      if (isSameOriginApiCall(request)) return;

      request.log.info(
        { origin: request.headers.origin ?? null, host: request.host },
        'csrf check rejected the request',
      );
      return reply.code(403).send(errorBody(ApiErrorCode.CsrfRejected));
    });
  },
  { name: 'csrf' },
);

function isSameOriginApiCall(request: FastifyRequest): boolean {
  if (request.headers['x-pra-request'] !== '1') return false;
  const origin = request.headers.origin;
  if (!origin || origin === 'null') return false;
  try {
    const originUrl = new URL(origin);
    // Parsed with the Origin's scheme, so a default port (`:443`, `:80`) compares equal.
    const requestHost = new URL(`${originUrl.protocol}//${request.host}`).host;
    return originUrl.host === requestHost;
  } catch {
    return false;
  }
}

function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
