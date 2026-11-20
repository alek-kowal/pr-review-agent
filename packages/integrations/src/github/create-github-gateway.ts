import { readFileSync } from 'node:fs';
import { GITHUB_TOKEN_ENV, githubModeOf } from '@pra/core';
import { GITHUB_ENV, type GitHubGateway } from './github-gateway.ts';
import {
  OctokitGitHubGateway,
  type OctokitGitHubGatewayOptions,
} from './octokit-github-gateway.ts';
import { TokenGitHubGateway, type TokenGitHubGatewayOptions } from './token-github-gateway.ts';

/**
 * The gateway the env selects (P-28): the GitHub App when `GITHUB_APP_ID`,
 * `GITHUB_APP_PRIVATE_KEY_PATH` (a readable, non-empty key file) and `GITHUB_WEBHOOK_SECRET` are
 * set; otherwise read-only token mode with `GITHUB_TOKEN`, or anonymous without it. A partly set
 * App falls back to token mode and names what is missing.
 */
export function createGitHubGateway(
  env: NodeJS.ProcessEnv = process.env,
  options: Pick<OctokitGitHubGatewayOptions, 'now'> & Pick<TokenGitHubGatewayOptions, 'fetch'> = {},
): GitHubGateway {
  const missing: string[] = GITHUB_ENV.filter((name) => !env[name]?.trim());
  if (githubModeOf(env) === 'app') {
    const privateKey = readKey(env.GITHUB_APP_PRIVATE_KEY_PATH!);
    if (privateKey) {
      return new OctokitGitHubGateway({
        appId: env.GITHUB_APP_ID!,
        privateKey,
        webhookSecret: env.GITHUB_WEBHOOK_SECRET!,
        ...(options.now ? { now: options.now } : {}),
      });
    }
    missing.push('GITHUB_APP_PRIVATE_KEY_PATH');
  }
  return new TokenGitHubGateway({
    token: env[GITHUB_TOKEN_ENV],
    missingEnv: missing,
    ...options,
  });
}

function readKey(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}
