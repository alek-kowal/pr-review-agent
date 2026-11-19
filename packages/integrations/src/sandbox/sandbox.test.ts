import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { IntegrationError, IntegrationNotConfiguredError } from '../errors.ts';
import { createSandbox, DockerSandbox, dockerCliEnv, dockerCreateArgs } from './docker-sandbox.ts';
import { INSTALL_ENV } from './install.ts';
import type { SandboxRunSpec } from './sandbox.ts';

const spec: SandboxRunSpec = {
  image: 'node:24-slim',
  command: ['sh', '-c', 'echo hi'],
  workdir: '/work',
  mounts: [
    { hostPath: '/host/worktree', containerPath: '/work', writable: true },
    { hostPath: '/host/cache', containerPath: '/cache' },
  ],
  env: { HOME: '/tmp', CI: '1' },
  limits: { cpus: 2, memoryMb: 2048, pids: 512, timeoutMs: 60_000 },
  labels: { 'pra.run': 'r1' },
};
const options = { name: 'pra-sbx-test', runtime: null, user: '501:20' };

/** The value after each occurrence of `flag`. */
function values(args: string[], flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + 1]!] : []));
}

describe('no model secret in the sandbox', () => {
  test('the docker CLI env drops the subscription token, the API key and other secrets', () => {
    const env = dockerCliEnv(
      {
        PATH: '/usr/bin',
        HOME: '/Users/me',
        CLAUDE_CODE_OAUTH_TOKEN: 'oat-secret',
        ANTHROPIC_API_KEY: 'sk-secret',
        GITHUB_APP_PRIVATE_KEY: 'pem',
        DATABASE_URL: 'postgres://u:p@h/db',
      },
      'tcp://sandbox:2375',
    );
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/Users/me', DOCKER_HOST: 'tcp://sandbox:2375' });
  });

  test('the container gets only the env its spec names', () => {
    const args = dockerCreateArgs(spec, options);
    expect(values(args, '--env').sort()).toEqual(['CI=1', 'HOME=/tmp']);
    expect(Object.keys(INSTALL_ENV).some((name) => /TOKEN|API_KEY/.test(name))).toBe(false);
  });
});

describe('dockerCreateArgs', () => {
  test('locks the container down by default', () => {
    const args = dockerCreateArgs(spec, options);
    expect(args[0]).toBe('create');
    expect(values(args, '--name')).toEqual(['pra-sbx-test']);
    expect(values(args, '--network')).toEqual(['none']);
    expect(args).toContain('--read-only');
    expect(values(args, '--cap-drop')).toEqual(['ALL']);
    expect(values(args, '--security-opt')).toEqual(['no-new-privileges']);
    expect(values(args, '--user')).toEqual(['501:20']);
    expect(values(args, '--tmpfs')[0]).toMatch(/^\/tmp:/);
    expect(values(args, '--runtime')).toEqual([]);
    expect(args).not.toContain('--privileged');
  });

  test('labels every container and adds the caller labels', () => {
    expect(values(dockerCreateArgs(spec, options), '--label')).toEqual([
      'pra.sandbox=1',
      'pra.run=r1',
    ]);
  });

  test('applies the limits, memory without swap', () => {
    const args = dockerCreateArgs(spec, options);
    expect(values(args, '--cpus')).toEqual(['2']);
    expect(values(args, '--memory')).toEqual(['2048m']);
    expect(values(args, '--memory-swap')).toEqual(['2048m']);
    expect(values(args, '--pids-limit')).toEqual(['512']);
  });

  test('mounts read-only unless writable', () => {
    expect(values(dockerCreateArgs(spec, options), '--mount')).toEqual([
      'type=bind,source=/host/worktree,target=/work',
      'type=bind,source=/host/cache,target=/cache,readonly',
    ]);
  });

  test('passes only the allow-listed env', () => {
    expect(values(dockerCreateArgs(spec, options), '--env')).toEqual(['HOME=/tmp', 'CI=1']);
    expect(values(dockerCreateArgs({ ...spec, env: undefined }, options), '--env')).toEqual([]);
  });

  test('ends with the image, workdir set, then the command', () => {
    const args = dockerCreateArgs(spec, options);
    expect(values(args, '--workdir')).toEqual(['/work']);
    expect(args.slice(-4)).toEqual(['node:24-slim', 'sh', '-c', 'echo hi']);
  });

  test('egress uses the bridge network; gVisor when the daemon has it', () => {
    const args = dockerCreateArgs({ ...spec, network: 'egress' }, { ...options, runtime: 'runsc' });
    expect(values(args, '--network')).toEqual(['bridge']);
    expect(values(args, '--runtime')).toEqual(['runsc']);
  });

  test('refuses mount paths that would inject mount options', () => {
    const mounts = [{ hostPath: '/a,readonly=false', containerPath: '/work' }];
    expect(() => dockerCreateArgs({ ...spec, mounts }, options)).toThrow(IntegrationError);
  });

  test('refuses env names that are not plain names', () => {
    expect(() => dockerCreateArgs({ ...spec, env: { 'A=B': 'x' } }, options)).toThrow(
      IntegrationError,
    );
  });
});

describe('DockerSandbox without a reachable daemon', () => {
  let dir: string;
  let failingDocker: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'pra-sbx-unit-'));
    // A docker CLI whose daemon is down: records DOCKER_HOST and fails every command.
    failingDocker = path.join(dir, 'docker');
    await writeFile(
      failingDocker,
      `#!/bin/sh\nprintf '%s' "$DOCKER_HOST" > "${dir}/docker-host"\nexit 1\n`,
    );
    await chmod(failingDocker, 0o755);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  test('a missing docker binary is sandbox_not_configured', async () => {
    const sandbox = new DockerSandbox({ docker: path.join(dir, 'no-such-docker') });
    const error = await sandbox.run(spec).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationNotConfiguredError);
    expect(error).toMatchObject({ code: 'sandbox_not_configured' });
  });

  test('an unreachable daemon is sandbox_not_configured, with SANDBOX_DOCKER_HOST as DOCKER_HOST', async () => {
    const sandbox = new DockerSandbox({ docker: failingDocker, dockerHost: 'tcp://nowhere:1' });
    await expect(sandbox.run(spec)).rejects.toMatchObject({
      code: 'sandbox_not_configured',
      params: { missing: ['SANDBOX_DOCKER_HOST'] },
    });
    expect(await readFile(path.join(dir, 'docker-host'), 'utf8')).toBe('tcp://nowhere:1');
  });

  test('an already aborted signal rejects before any docker call', async () => {
    const sandbox = new DockerSandbox({ docker: path.join(dir, 'no-such-docker') });
    await expect(sandbox.run({ ...spec, signal: AbortSignal.abort() })).rejects.toMatchObject({
      code: 'sandbox_cancelled',
    });
  });

  test('createSandbox builds a DockerSandbox from the env', () => {
    expect(
      createSandbox({ SANDBOX_DOCKER_HOST: 'unix:///run/user/1000/docker.sock' }),
    ).toBeInstanceOf(DockerSandbox);
  });
});
