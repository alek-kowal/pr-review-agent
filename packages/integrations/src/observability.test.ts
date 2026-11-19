import { Writable } from 'node:stream';
import { trace } from '@opentelemetry/api';
import * as Sentry from '@sentry/node';
import { pino } from 'pino';
import { afterEach, describe, expect, test } from 'vitest';
import { loggerOptions } from './logging.ts';
import { reportError, startObservability, type Observability } from './observability.ts';
import { DUMMY_SENTRY_DSN, stubSentryTransport } from './testing/index.ts';

let running: Observability | undefined;
afterEach(async () => {
  await running?.shutdown();
  running = undefined;
});

describe('startObservability', () => {
  test('without SENTRY_DSN or an OTLP endpoint: no Sentry client and no exporter', async () => {
    running = startObservability({ service: 'test', env: {}, esmLoaderHook: false });

    expect(running.sentry).toBe(false);
    expect(running.exporter).toBe(false);
    expect(Sentry.getClient()).toBeUndefined();
    expect(await running.sendTestEvent()).toBeUndefined();
    expect(() => reportError(new Error('ignored'))).not.toThrow();
  });

  test('with a DSN, the client starts and events reach the transport', async () => {
    const { envelopes, transport } = stubSentryTransport();
    running = startObservability({
      service: 'test',
      env: {
        SENTRY_DSN: DUMMY_SENTRY_DSN,
        SENTRY_ENVIRONMENT: 'ci',
        SENTRY_RELEASE: 'pra@1.2.3',
      },
      sentryTransport: transport,
      esmLoaderHook: false,
    });

    expect(running.sentry).toBe(true);
    expect(Sentry.getClient()?.getOptions()).toMatchObject({
      environment: 'ci',
      release: 'pra@1.2.3',
    });
    const id = await running.sendTestEvent();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(envelopes.join('\n')).toContain('PR Review Agent test event from test');
  });

  test('the OTLP endpoint turns the exporter on', () => {
    running = startObservability({
      service: 'test',
      env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' },
      esmLoaderHook: false,
    });
    expect(running.exporter).toBe(true);
  });

  test('pino lines written inside a span carry trace_id and span_id', () => {
    running = startObservability({ service: 'test', env: {}, esmLoaderHook: false });
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
        done();
      },
    });
    const logger = pino(loggerOptions('test', { NODE_ENV: 'production' }), stream);

    logger.info('outside');
    const ids = trace.getTracer('test').startActiveSpan('work', (span) => {
      logger.info('inside');
      span.end();
      return span.spanContext();
    });

    expect(lines[0]).not.toHaveProperty('trace_id');
    expect(lines[1]).toMatchObject({ trace_id: ids.traceId, span_id: ids.spanId });
  });
});
