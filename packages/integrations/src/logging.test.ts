import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, test } from 'vitest';
import { loggerOptions, redactSecrets } from './logging.ts';

const PEM = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----\n';

function capture(env: NodeJS.ProcessEnv = { NODE_ENV: 'production' }) {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const logger = pino(loggerOptions('test-service', env), stream);
  const parsed = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  return { logger, lines, parsed };
}

describe('loggerOptions', () => {
  test('production writes one JSON line per entry with the service name', () => {
    const { logger, lines, parsed } = capture();

    logger.info('worker started');

    expect(lines).toHaveLength(1);
    expect(lines[0]!.trimEnd()).not.toContain('\n');
    expect(parsed()[0]).toMatchObject({ service: 'test-service', msg: 'worker started' });
  });

  test('redacted fields print [Redacted]', () => {
    const { logger, parsed } = capture();

    logger.info(
      {
        req: { method: 'POST', headers: { authorization: 'Bearer abc', 'x-other': 'kept' } },
        env: {
          ANTHROPIC_API_KEY: 'sk-ant-1',
          GITHUB_WEBHOOK_SECRET: 'whsec',
          AWS_SECRET_ACCESS_KEY: 'aws-secret',
          DATABASE_URL: 'postgres://pra:pw@db/pra',
          GIT_CONFIG_VALUE_0: 'Authorization: Basic eC1hY2Nlc3M=',
          AWS_ACCESS_KEY_ID: 'AKIA-id',
          BLOB_DIR: '.data',
        },
        s3: { credentials: { accessKeyId: 'AKIA-id', secretAccessKey: 'aws-secret' } },
        clickup: { apiKey: 'pk_1' },
        github: { privateKey: PEM, appId: 42 },
        keyFile: PEM,
      },
      'config loaded',
    );

    expect(parsed()[0]).toMatchObject({
      req: { method: 'POST', headers: { authorization: '[Redacted]', 'x-other': 'kept' } },
      env: {
        ANTHROPIC_API_KEY: '[Redacted]',
        GITHUB_WEBHOOK_SECRET: '[Redacted]',
        AWS_SECRET_ACCESS_KEY: '[Redacted]',
        DATABASE_URL: '[Redacted]',
        GIT_CONFIG_VALUE_0: '[Redacted]',
        AWS_ACCESS_KEY_ID: 'AKIA-id',
        BLOB_DIR: '.data',
      },
      s3: { credentials: { accessKeyId: 'AKIA-id', secretAccessKey: '[Redacted]' } },
      clickup: { apiKey: '[Redacted]' },
      github: { privateKey: '[Redacted]', appId: 42 },
      keyFile: '[Redacted]',
    });
  });

  test('errors still go through the error serializer', () => {
    const { logger, parsed } = capture();

    logger.error({ err: new Error('boom') }, 'failed');

    expect(parsed()[0]).toMatchObject({ err: { type: 'Error', message: 'boom' } });
  });

  test('development pretty-prints through pino-pretty', () => {
    const options = loggerOptions('api', { NODE_ENV: 'development' });

    expect(options.transport).toMatchObject({ target: expect.stringContaining('pino-pretty') });
  });

  test('LOG_LEVEL sets the level', () => {
    expect(loggerOptions('api', { NODE_ENV: 'production', LOG_LEVEL: 'debug' }).level).toBe(
      'debug',
    );
  });
});

describe('redactSecrets', () => {
  test('does not change the logged object', () => {
    const input = { headers: { authorization: 'Bearer abc' } };

    redactSecrets(input);

    expect(input.headers.authorization).toBe('Bearer abc');
  });

  test('keeps empty secret values visible, so a missing key shows up in logs', () => {
    expect(redactSecrets({ ANTHROPIC_API_KEY: undefined, GITHUB_WEBHOOK_SECRET: null })).toEqual({
      ANTHROPIC_API_KEY: undefined,
      GITHUB_WEBHOOK_SECRET: null,
    });
  });
});
