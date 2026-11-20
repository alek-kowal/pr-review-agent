import type { LevelInstructionGap } from '@pra/core';

export interface GapLine {
  levels: number[];
  stage: string;
  missing: string[];
}

/** One line per stage and missing files: the levels that share them, lowest first. */
export function groupGaps(gaps: readonly LevelInstructionGap[]): GapLine[] {
  const lines = new Map<string, GapLine>();
  for (const gap of gaps) {
    const key = `${gap.stage}:${gap.missing.join(',')}`;
    const line = lines.get(key) ?? { levels: [], stage: gap.stage, missing: gap.missing };
    line.levels.push(gap.level);
    lines.set(key, line);
  }
  return [...lines.values()].map((l) => ({ ...l, levels: l.levels.toSorted((a, b) => a - b) }));
}
