// Readers for stage outputs, which Run detail receives as untyped JSON.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
