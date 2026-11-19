import { createTransport } from '@sentry/node';
import type { SentryTransport } from '../observability.ts';

/** A Sentry transport that keeps every envelope in memory, so no event leaves the test. */
export function stubSentryTransport(): { envelopes: string[]; transport: SentryTransport } {
  const envelopes: string[] = [];
  const transport: SentryTransport = (options) =>
    createTransport(options, async (request) => {
      envelopes.push(
        typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body),
      );
      return { statusCode: 200 };
    });
  return { envelopes, transport };
}

/** A well-formed DSN that points nowhere; pair it with `stubSentryTransport`. */
export const DUMMY_SENTRY_DSN = 'https://public@o0.ingest.sentry.io/0';
