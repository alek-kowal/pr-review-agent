import { createRequire } from 'node:module';
import { isSpanContextValid, trace } from '@opentelemetry/api';
import { hostname } from 'node:os';
import { pino, type Logger, type LoggerOptions } from 'pino';

export type { Logger };

export const REDACTED = '[Redacted]';

// Keys whose values never reach a log line: authorization headers, `*_API_KEY`, `*_SECRET`,
// passwords, tokens and private keys, in env-style and camelCase spellings.
const SECRET_KEY = /(authorization|api_?key|secret|password|token|private_?key)$/i;
// A PEM private key, wherever it appears (e.g. a GitHub App key read from disk).
const PRIVATE_KEY_PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const MAX_DEPTH = 8;

/**
 * Pino options shared by api and worker: JSON lines with a `service` field in production (and in
 * tests), pretty output in development, and secrets redacted. Fastify takes these as `logger`.
 */
export function loggerOptions(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): LoggerOptions {
  const pretty = env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test';
  return {
    level: env.LOG_LEVEL || 'info',
    base: { service, pid: process.pid, hostname: hostname() },
    // Exact paths are cheap and run after serializers (e.g. a request serializer adding headers).
    redact: {
      paths: [
        'authorization',
        'headers.authorization',
        'req.headers.authorization',
        'request.headers.authorization',
        'res.headers.authorization',
      ],
      censor: REDACTED,
    },
    // Lines written inside an OpenTelemetry span carry its ids (observability.ts starts tracing).
    mixin: traceFields,
    // Key patterns pino's `redact` cannot express: walks each entry's plain objects and arrays.
    // Pino does not run formatters on `logger.child({...})` bindings, so bindings carry ids only.
    formatters: { log: (object) => redactSecrets(object) },
    ...(pretty && {
      transport: {
        // Resolved here: pnpm keeps pino-pretty out of reach of pino's own resolution.
        target: createRequire(import.meta.url).resolve('pino-pretty'),
        options: { translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
      },
    }),
  };
}

/** `trace_id` and `span_id` of the active span, or nothing outside a span. */
export function traceFields(): Record<string, string> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}

/** A pino logger with `loggerOptions(service)`, for processes that are not Fastify (the worker). */
export function createLogger(service: string, env: NodeJS.ProcessEnv = process.env): Logger {
  return pino(loggerOptions(service, env));
}

/**
 * Returns a copy of `value` with secret keys and PEM private keys replaced by `[Redacted]`.
 * Class instances (errors, requests) are left for pino's serializers.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (typeof value === 'string') {
    return (PRIVATE_KEY_PEM.test(value) ? REDACTED : value) as T;
  }
  if (depth >= MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item: unknown) => redactSecrets(item, depth + 1)) as T;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    copy[key] = SECRET_KEY.test(key) && item != null ? REDACTED : redactSecrets(item, depth + 1);
  }
  return copy as T;
}
