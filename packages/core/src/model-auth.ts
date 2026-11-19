// P-25: how the agents reach the model. A Claude subscription token (`claude setup-token`) wins
// over an API key; neither value ever leaves the worker's own env. Only the mode's name is shown.
import { OPENROUTER_API_KEY_ENV } from './openrouter.ts';

/** The env var of each mode. Names only: values live in the gitignored `.env`. */
export const MODEL_AUTH_ENV = Object.freeze({
  subscription: 'CLAUDE_CODE_OAUTH_TOKEN',
  api_key: 'ANTHROPIC_API_KEY',
} as const);

export const MODEL_AUTH_MODES = ['subscription', 'api_key', 'none'] as const;
export type ModelAuthMode = (typeof MODEL_AUTH_MODES)[number];

/** Every env var that holds a model secret; nothing the agent or the sandbox runs may get one. */
export const MODEL_SECRET_ENV_NAMES: readonly string[] = Object.freeze([
  ...Object.values(MODEL_AUTH_ENV),
  OPENROUTER_API_KEY_ENV,
]);

const isSet = (value: string | undefined): value is string => !!value && value.trim() !== '';

/** The active mode: the subscription when its token is set (even with a key), else the key. */
export function modelAuthModeOf(env: Readonly<Record<string, string | undefined>>): ModelAuthMode {
  if (isSet(env[MODEL_AUTH_ENV.subscription])) return 'subscription';
  if (isSet(env[MODEL_AUTH_ENV.api_key])) return 'api_key';
  return 'none';
}
