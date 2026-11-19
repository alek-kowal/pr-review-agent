// Pilot metrics (S-19, docs/06-metrics.md): pure rules over PR histories.

/** A commit as GitHub reports it: its parents in order, and its message. */
export type CommitInfo = { parents: readonly string[]; message: string };

const UPDATE_BRANCH_MESSAGE = /^Merge (?:remote-tracking )?branch '[^']+' into /;

/**
 * Whether a head change is a base merge ("Update branch" on GitHub, or the same merge by hand):
 * a merge commit on top of the old head whose other parent is the base, or whose message is
 * git's merge message. Metric 5 ignores these.
 */
export function isBaseMerge(change: {
  beforeSha: string;
  baseSha: string;
  commit: CommitInfo | null;
}): boolean {
  const { commit } = change;
  if (!commit || commit.parents.length !== 2) return false;
  const [first, second] = commit.parents;
  if (first !== change.beforeSha) return false;
  return second === change.baseSha || UPDATE_BRANCH_MESSAGE.test(commit.message);
}
