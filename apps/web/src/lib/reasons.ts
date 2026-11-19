import { copy } from '@/copy/index.ts';

/** Copy for a failure reason code ("model access is not configured"). */
export const reasonText = (code: string): string => copy.reasons[code] ?? copy.unknownReason(code);

/** Copy for an api error code, as a whole sentence. */
export const errorText = (code: string): string => copy.errors[code] ?? copy.unknownError(code);

export const stageName = (key: string): string => copy.stages[key] ?? key;
