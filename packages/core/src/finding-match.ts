// S-08-T7: the same finding in a later round (FR-043). A finding matches when it is in the same file
// and says the same thing: its normalised title and scenario are alike. The line is ignored, so a
// finding whose code moved still matches.

/** What matching reads of a finding. */
export type MatchableFinding = {
  file: string;
  title: string;
  scenario: string;
  /** Ignored: a finding whose code moved is still the same finding. */
  line?: number | null;
};

/** How alike two findings' words must be (0 to 1) to count as the same finding. */
export const FINDING_MATCH_THRESHOLD = 0.75;

/** Lower case, inline code marks and punctuation dropped, single spaces. */
export function normaliseFindingText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_.]+/gu, ' ')
    .replace(/(^|\s)\.+|\.+(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(finding: MatchableFinding): Set<string> {
  const text = normaliseFindingText(`${finding.title} ${finding.scenario}`);
  return new Set(text ? text.split(' ') : []);
}

/** How alike two findings' words are: shared words over all words (Jaccard), 0 to 1. */
export function findingSimilarity(a: MatchableFinding, b: MatchableFinding): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 && right.size === 0) return 1;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** Whether `next` is `previous` found again: same file, alike title and scenario. */
export function matchFinding(previous: MatchableFinding, next: MatchableFinding): boolean {
  return (
    previous.file === next.file && findingSimilarity(previous, next) >= FINDING_MATCH_THRESHOLD
  );
}

/**
 * Pairs earlier findings with later ones, most alike first, each finding in at most one pair.
 * Returns `[previous, next]` pairs.
 */
export function matchFindings<P extends MatchableFinding, N extends MatchableFinding>(
  previous: readonly P[],
  next: readonly N[],
): [P, N][] {
  const candidates = previous
    .flatMap((p) =>
      next.flatMap((n) => (matchFinding(p, n) ? [{ p, n, score: findingSimilarity(p, n) }] : [])),
    )
    .sort((a, b) => b.score - a.score);
  const usedPrevious = new Set<P>();
  const usedNext = new Set<N>();
  const pairs: [P, N][] = [];
  for (const { p, n } of candidates) {
    if (usedPrevious.has(p) || usedNext.has(n)) continue;
    usedPrevious.add(p);
    usedNext.add(n);
    pairs.push([p, n]);
  }
  return pairs;
}
