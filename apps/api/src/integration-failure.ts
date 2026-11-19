// How routes read a gateway failure (`IntegrationError` and its subclasses).
import { CLICKUP_AUTH_FAILED, CLICKUP_NOT_CONFIGURED } from '@pra/integrations';
import type { FastifyReply } from 'fastify';
import { ApiErrorCode, sendError } from './plugins/errors.ts';

/**
 * An `IntegrationError`'s code and params, by shape: autoload imports routes through their own
 * module graph, so `instanceof` can miss the gateway's class.
 */
export function integrationFailure(
  error: unknown,
): { code: string; params: Record<string, unknown> } | null {
  const failure = error as { name?: unknown; code?: unknown; params?: unknown } | null;
  if (!(error instanceof Error) || !String(failure?.name).startsWith('Integration')) return null;
  if (typeof failure?.code !== 'string') return null;
  const params =
    failure.params && typeof failure.params === 'object' && !Array.isArray(failure.params)
      ? (failure.params as Record<string, unknown>)
      : {};
  return { code: failure.code, params };
}

/** A failed ClickUp call: 422 when ClickUp is not configured, else 502. */
export function sendClickUpFailure(
  reply: FastifyReply,
  failure: ReturnType<typeof integrationFailure> & {},
) {
  if (failure.code === CLICKUP_NOT_CONFIGURED) {
    return sendError(reply, 422, ApiErrorCode.ClickupNotConfigured, failure.params);
  }
  const code =
    failure.code === CLICKUP_AUTH_FAILED
      ? ApiErrorCode.ClickupAuthFailed
      : ApiErrorCode.ClickupError;
  return sendError(reply, 502, code, failure.params);
}
