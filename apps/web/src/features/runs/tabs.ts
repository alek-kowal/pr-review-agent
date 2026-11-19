export const RUN_TABS = ['stages', 'transcript'] as const;
export type RunTab = (typeof RUN_TABS)[number];

export const isRunTab = (value: unknown): value is RunTab => RUN_TABS.includes(value as RunTab);
