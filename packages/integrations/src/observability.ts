import { register } from 'node:module';
import { context, propagation, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import * as Sentry from '@sentry/node';

/** Sentry's transport factory; tests pass a stub so no event leaves the process. */
export type SentryTransport = NonNullable<Sentry.NodeOptions['transport']>;

export type ObservabilityOptions = {
  /** `service.name` on spans and the Sentry `server_name` tag: `api` or `worker`. */
  service: string;
  env?: NodeJS.ProcessEnv;
  sentryTransport?: SentryTransport;
  /**
   * Registers the ESM loader hook that lets OpenTelemetry patch ESM imports (e.g. `pg` imported by
   * drizzle). On by default; only `node --import` callers need it, so tests turn it off.
   */
  esmLoaderHook?: boolean;
};

export type Observability = {
  /** True when `SENTRY_DSN` is set and the Sentry client is running. */
  readonly sentry: boolean;
  /** True when `OTEL_EXPORTER_OTLP_ENDPOINT` is set and spans are exported. */
  readonly exporter: boolean;
  /** Sends one test event to Sentry and returns its id (`sentry:test`). */
  sendTestEvent(): Promise<string | undefined>;
  /** Flushes and stops Sentry and the tracer, and clears the OpenTelemetry globals. */
  shutdown(): Promise<void>;
};

/**
 * Starts tracing and error reporting for one process. Called from the app's `instrument.ts`,
 * which `node --import` loads before the app, so the instrumentations patch http, Fastify and pg
 * before they are imported.
 * - OpenTelemetry always runs (pino lines get `trace_id`); spans leave the process only when the
 *   standard `OTEL_EXPORTER_OTLP_ENDPOINT` is set (the exporter reads the other `OTEL_*` vars).
 * - Sentry starts only with `SENTRY_DSN`, with `SENTRY_ENVIRONMENT` (default `NODE_ENV`) and
 *   `SENTRY_RELEASE`. It reports errors; traces stay in OpenTelemetry.
 */
export function startObservability(options: ObservabilityOptions): Observability {
  const env = options.env ?? process.env;

  if (options.esmLoaderHook ?? true) {
    register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
  }

  const exporter = Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': options.service }),
    spanProcessors: exporter ? [new BatchSpanProcessor({ exporter: new OTLPTraceExporter() })] : [],
  });
  const contextManager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(contextManager);
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(provider);
  const unregister = registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      new HttpInstrumentation(),
      new PgInstrumentation(),
      new FastifyOtelInstrumentation({ registerOnInitialization: true }),
    ],
  });

  const dsn = env.SENTRY_DSN;
  const sentryClient = dsn
    ? Sentry.init({
        dsn,
        environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV || 'development',
        ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
        serverName: options.service,
        // Our tracer provider owns OpenTelemetry; Sentry only reports errors.
        enableOpenTelemetrySetup: false,
        enableRuntimeChannelInjection: false,
        ...(options.sentryTransport ? { transport: options.sentryTransport } : {}),
      })
    : undefined;

  return {
    sentry: sentryClient !== undefined,
    exporter,
    async sendTestEvent() {
      if (!sentryClient) return undefined;
      const id = Sentry.captureMessage(`PR Review Agent test event from ${options.service}`);
      await Sentry.flush(5_000);
      return id;
    },
    async shutdown() {
      if (sentryClient) {
        await Sentry.close(5_000);
        Sentry.getCurrentScope().setClient(undefined);
      }
      unregister();
      await provider.shutdown();
      contextManager.disable();
      trace.disable();
      context.disable();
      propagation.disable();
    },
  };
}

/** Reports an unexpected error to Sentry; does nothing when Sentry is off. */
export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  if (!Sentry.getClient()) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}
