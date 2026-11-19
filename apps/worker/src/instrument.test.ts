import type { Observability, SentryTransport } from '@pra/integrations/observability';
import { DUMMY_SENTRY_DSN, stubSentryTransport } from '@pra/integrations/testing';
import { afterEach, expect, test, vi } from 'vitest';

let running: Observability | undefined;
afterEach(async () => {
  await running?.shutdown();
  running = undefined;
  vi.unstubAllEnvs();
  vi.doUnmock('@pra/integrations/observability');
});

/** Imports a fresh `instrument.ts` under `env`; the stub transport keeps events in the test. */
async function loadInstrument(
  env: Record<string, string>,
  sentryTransport?: SentryTransport,
): Promise<Observability> {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  vi.doMock('@pra/integrations/observability', async (importOriginal) => {
    const original = await importOriginal<typeof import('@pra/integrations/observability')>();
    return {
      ...original,
      startObservability: (options: Parameters<typeof original.startObservability>[0]) =>
        original.startObservability({
          ...options,
          esmLoaderHook: false,
          ...(sentryTransport ? { sentryTransport } : {}),
        }),
    };
  });
  const { observability } = await import('./instrument.ts');
  running = observability;
  return observability;
}

test('without SENTRY_DSN there is no Sentry client and no exporter', async () => {
  const observability = await loadInstrument({ SENTRY_DSN: '', OTEL_EXPORTER_OTLP_ENDPOINT: '' });

  expect(observability.sentry).toBe(false);
  expect(observability.exporter).toBe(false);
});

test('with a dummy DSN and a stubbed transport the client starts and sends', async () => {
  const { envelopes, transport } = stubSentryTransport();
  const observability = await loadInstrument({ SENTRY_DSN: DUMMY_SENTRY_DSN }, transport);

  expect(observability.sentry).toBe(true);
  expect(await observability.sendTestEvent()).toBeTruthy();
  expect(envelopes.join('\n')).toContain('test event from worker');
});
