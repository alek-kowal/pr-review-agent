import { copy } from '@/copy/index.ts';

/**
 * Copy for a failure reason code ("model access is not configured"); `params` fill an entry that
 * names them (the missing instruction files). A code without copy reads "error <code>".
 */
export const reasonText = (code: string, params?: Record<string, unknown> | null): string => {
  const entry = copy.reasons[code];
  if (typeof entry === 'function') return entry(params ?? {});
  return entry ?? copy.unknownReason(code);
};

/** Copy for an api error code, as a whole sentence. */
export const errorText = (code: string): string => copy.errors[code] ?? copy.unknownError(code);

export const stageName = (key: string): string => copy.stages[key] ?? key;
