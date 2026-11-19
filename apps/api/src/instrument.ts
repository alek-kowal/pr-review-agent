// Loaded first with `node --import` (package.json scripts, Dockerfile CMD), so OpenTelemetry
// patches http, Fastify and pg before the api imports them. Sentry starts only with SENTRY_DSN;
// spans are exported only with OTEL_EXPORTER_OTLP_ENDPOINT.
import { startObservability } from '@pra/integrations/observability';

export const observability = startObservability({ service: 'api' });
