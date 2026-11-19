// S-22-T6: a trial compares two runs on one commit: A with the active instructions, B with a draft.
import './reasons/trial.ts';
import type { StageKey } from './vocabulary.ts';

/**
 * Round stages a trial run skips: Checks reads GitHub and Task reads ClickUp, and a trial never
 * calls either. Both runs skip them, so the compare stays fair.
 */
export const TRIAL_OFF_STAGES: readonly StageKey[] = ['checks', 'task'];

/** What the compare reads of a finding. */
export interface ComparableFinding {
  file: string;
  /** Null for a finding about the whole file. */
  line: number | null;
  title: string;
}

export interface FindingsComparison<A, B> {
  onlyA: A[];
  onlyB: B[];
  /** Pairs that match, in A's order. */
  both: { a: A; b: B }[];
}

/** How far apart two findings' lines may be and still overlap (the same issue, anchored nearby). */
export const LINE_OVERLAP = 3;

/** A title in lower case, without punctuation and with single spaces. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const linesOverlap = (a: number | null, b: number | null) =>
  a === null || b === null || Math.abs(a - b) <= LINE_OVERLAP;

/** Whether two findings are the same: same file, overlapping lines and the same normalised title. */
export function sameFinding(a: ComparableFinding, b: ComparableFinding): boolean {
  return (
    a.file === b.file &&
    linesOverlap(a.line, b.line) &&
    normaliseTitle(a.title) === normaliseTitle(b.title)
  );
}

/**
 * Splits two runs' findings into only in A, only in B and in both. Each finding matches at most
 * one of the other run's, the closest line first.
 */
export function compareFindings<A extends ComparableFinding, B extends ComparableFinding>(
  a: readonly A[],
  b: readonly B[],
): FindingsComparison<A, B> {
  const pairs: { i: number; j: number; distance: number }[] = [];
  a.forEach((x, i) =>
    b.forEach((y, j) => {
      if (sameFinding(x, y)) pairs.push({ i, j, distance: distance(x, y) });
    }),
  );
  pairs.sort((p, q) => p.distance - q.distance || p.i - q.i || p.j - q.j);
  const matchOfA = new Map<number, number>();
  const matchedB = new Set<number>();
  for (const { i, j } of pairs) {
    if (matchOfA.has(i) || matchedB.has(j)) continue;
    matchOfA.set(i, j);
    matchedB.add(j);
  }
  return {
    onlyA: a.filter((_, i) => !matchOfA.has(i)),
    onlyB: b.filter((_, j) => !matchedB.has(j)),
    both: a.flatMap((x, i) => (matchOfA.has(i) ? [{ a: x, b: b[matchOfA.get(i)!]! }] : [])),
  };
}

const distance = (a: ComparableFinding, b: ComparableFinding) =>
  a.line === null || b.line === null ? LINE_OVERLAP + 1 : Math.abs(a.line - b.line);
