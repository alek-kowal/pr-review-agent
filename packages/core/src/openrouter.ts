// P-26: the change-type judge may run on an OpenRouter model. Names only; no secrets here.
import type { AgentRole } from './vocabulary.ts';

/** Settings name an OpenRouter model `openrouter/<vendor>/<model>`. */
export const OPENROUTER_PREFIX = 'openrouter/';
/** The key's env var name (pay per token on OpenRouter's credits). */
export const OPENROUTER_API_KEY_ENV = 'OPENROUTER_API_KEY';
/** The roles that may pick an OpenRouter model: only the judge (one call, no tools). */
export const OPENROUTER_ROLES: readonly AgentRole[] = Object.freeze(['judge']);
/** Offered for those roles in Settings → Models, beside the Claude models. */
export const OPENROUTER_SUGGESTED_MODELS: readonly string[] = Object.freeze([
  'openrouter/typesafe/jev-router',
]);

/** Where a model runs; a session records it. */
export const MODEL_PROVIDERS = ['anthropic', 'openrouter'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}';
const OPENROUTER_MODEL = new RegExp(`^${OPENROUTER_PREFIX}${SEGMENT}/${SEGMENT}$`);

export const isOpenRouterModel = (name: string): boolean => name.startsWith(OPENROUTER_PREFIX);

/** `openrouter/<vendor>/<model>`, each part as plain as a Claude model name. */
export const validOpenRouterModel = (name: string): boolean => OPENROUTER_MODEL.test(name);

/** The id OpenRouter knows: `openrouter/typesafe/jev-router` → `typesafe/jev-router`. */
export const openRouterModelId = (name: string): string =>
  isOpenRouterModel(name) ? name.slice(OPENROUTER_PREFIX.length) : name;

export const providerOf = (model: string): ModelProvider =>
  isOpenRouterModel(model) ? 'openrouter' : 'anthropic';

export const canUseOpenRouter = (role: AgentRole): boolean => OPENROUTER_ROLES.includes(role);

/** Whether the key is set (names only; a blank value counts as unset). */
export function openRouterConfigured(env: Readonly<Record<string, string | undefined>>): boolean {
  const value = env[OPENROUTER_API_KEY_ENV];
  return !!value && value.trim() !== '';
}
