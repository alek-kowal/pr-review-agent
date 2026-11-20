// GitHub webhook ingest (S-01-T5): verify, store the payload unchanged, record the delivery once,
// queue it for the worker. The CSRF guard exempts this route; the signature protects it.
import { githubEventBlobKey, ingestGithubEvents } from '@pra/db';
import { assertBlobKey, GITHUB_NOT_CONFIGURED } from '@pra/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../plugins/errors.ts';

/** GitHub caps webhook payloads at 25 MB. */
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024;

export const WebhookAccepted = z.object({
  /** The `github_events` row; a redelivery answers with the stored one. */
  eventId: z.number().int(),
});

const WebhookHeaders = z.object({
  'x-github-delivery': z.string().optional(),
  'x-github-event': z.string().optional(),
  'x-hub-signature-256': z.string().optional(),
});

/** The fields of a payload the event row keeps; the rest stays in the blob. */
type PayloadSummary = {
  action?: unknown;
  number?: unknown;
  repository?: { full_name?: unknown } | null;
  pull_request?: { number?: unknown } | null;
};

const webhooks: FastifyPluginAsyncZod = async (fastify) => {
  // Signatures cover the exact bytes, so this plugin keeps the body raw and parses it itself.
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
    done(null, body),
  );

  fastify.post(
    '/github',
    {
      bodyLimit: MAX_PAYLOAD_BYTES,
      schema: {
        tags: ['webhooks'],
        summary: 'Receive a GitHub App webhook delivery',
        headers: WebhookHeaders,
        response: {
          202: WebhookAccepted,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { db, queue, github, blobStore } = fastify.deps;
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const headers = request.headers as z.output<typeof WebhookHeaders>;

      let verified: boolean;
      try {
        verified = await github.verifyWebhook(rawBody, headers['x-hub-signature-256']);
      } catch (error) {
        // By code, not `instanceof`: routes load through autoload's own `import()`.
        const failure = error as { code?: unknown; params?: { missing?: unknown } } | null;
        if (failure?.code === GITHUB_NOT_CONFIGURED) {
          return sendError(reply, 503, ApiErrorCode.GithubNotConfigured, {
            missing: failure.params?.missing ?? [],
          });
        }
        throw error;
      }
      if (!verified) {
        fastify.signatureFailures.record();
        return sendError(reply, 401, ApiErrorCode.WebhookSignatureInvalid);
      }

      const deliveryId = headers['x-github-delivery'] ?? '';
      const event = headers['x-github-event'] ?? '';
      // `poll-` ids belong to the poller (P-28); a webhook never takes one.
      if (
        !deliveryId ||
        !event ||
        deliveryId.startsWith('poll-') ||
        !isBlobKey(githubEventBlobKey(deliveryId))
      ) {
        return sendError(reply, 400, ApiErrorCode.InvalidRequest, { part: 'headers' });
      }

      let payload: PayloadSummary;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as PayloadSummary;
      } catch {
        return sendError(reply, 400, ApiErrorCode.InvalidRequest, { part: 'body' });
      }

      // The poller's path too (P-28): blob, one row per delivery id, a job with a fixed id.
      const [recorded] = (await ingestGithubEvents({ db, queue, blobStore }, [
        {
          deliveryId,
          event,
          rawBody,
          action: typeof payload.action === 'string' ? payload.action : null,
          repositoryFullName: stringOrNull(payload.repository?.full_name),
          prNumber: integerOrNull(payload.pull_request?.number ?? payload.number),
        },
      ]))!;
      return reply.code(202).send({ eventId: recorded!.event.id });
    },
  );
};

function isBlobKey(key: string): boolean {
  try {
    assertBlobKey(key);
    return true;
  } catch {
    return false;
  }
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const integerOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

export default webhooks;
