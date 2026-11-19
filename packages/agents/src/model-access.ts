import { MODEL_AUTH_ENV, modelAuthModeOf, type ModelAuthMode } from '@pra/core';

/**
 * The two ways to reach the model, as the adapters take them: `oauthToken` is
 * `CLAUDE_CODE_OAUTH_TOKEN` (a Claude subscription, from `claude setup-token`), `apiKey` is
 * `ANTHROPIC_API_KEY` (pay per token). The subscription wins when both are set.
 */
export type ModelCredentials = {
  oauthToken?: string | undefined;
  apiKey?: string | undefined;
};

/** The one secret a session gets, under its own env name; `none` runs nothing. */
export type ModelAccess =
  | { mode: 'subscription'; secret: string; env: { CLAUDE_CODE_OAUTH_TOKEN: string } }
  | { mode: 'api_key'; secret: string; env: { ANTHROPIC_API_KEY: string } }
  | { mode: 'none' };

/** The credentials from the worker's env (names from core `MODEL_AUTH_ENV`). */
export function credentialsFrom(env: NodeJS.ProcessEnv = process.env): ModelCredentials {
  return {
    oauthToken: env[MODEL_AUTH_ENV.subscription],
    apiKey: env[MODEL_AUTH_ENV.api_key],
  };
}

/** The active mode with its single secret. Only that one is ever passed on. */
export function modelAccessOf(credentials: ModelCredentials): ModelAccess {
  const mode: ModelAuthMode = modelAuthModeOf({
    [MODEL_AUTH_ENV.subscription]: credentials.oauthToken,
    [MODEL_AUTH_ENV.api_key]: credentials.apiKey,
  });
  if (mode === 'subscription') {
    const secret = credentials.oauthToken!.trim();
    return { mode, secret, env: { CLAUDE_CODE_OAUTH_TOKEN: secret } };
  }
  if (mode === 'api_key') {
    const secret = credentials.apiKey!.trim();
    return { mode, secret, env: { ANTHROPIC_API_KEY: secret } };
  }
  return { mode: 'none' };
}

/** `text` with the active secret replaced, for error details that are stored and shown. */
export function withoutSecret(text: string, access: ModelAccess): string {
  return access.mode === 'none' ? text : text.replaceAll(access.secret, '[redacted]');
}
