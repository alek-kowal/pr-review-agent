import type { Finding, PrSnapshot, Question, RoundResult } from '../src/model.ts';

let seq = 0;
const nextId = (prefix: string) => `${prefix}${++seq}`;

/** A Worth fixing finding, confirmed, undecided. */
export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: nextId('f'),
    severity: 'worth_fixing',
    title: 'A finding',
    file: 'src/index.ts',
    line: 1,
    scenario: 'What goes wrong',
    suggestion: 'How to fix it',
    remedy: 'obvious',
    verdict: 'confirmed',
    evidence: [],
    decision: null,
    resolved: null,
    ...overrides,
  };
}

export function makeQuestion(overrides: Partial<Question> = {}): Question {
  return { id: nextId('q'), answered: false, ...overrides };
}

/** A completed level 3 round with no findings, no questions and no sensitive files. */
export function makeRound(overrides: Partial<RoundResult> = {}): RoundResult {
  return {
    id: nextId('r'),
    status: 'completed',
    level: 3,
    findings: [],
    questions: [],
    sensitive: null,
    ...overrides,
  };
}

/** An open PR at level 3, reviewed at its head, with nothing left to do: Ready to merge. */
export function makePr(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    state: 'open',
    closedBy: null,
    draft: false,
    fork: false,
    author: 'kasia',
    level: 3,
    headSha: 'abc1234',
    reviewedSha: 'abc1234',
    commitsSinceReview: 0,
    changeType: 'changes_behaviour',
    activeRun: null,
    failedRound: null,
    chainRounds: 1,
    findings: [],
    questions: [],
    sensitive: null,
    patch: null,
    reviewers: 0,
    ci: [{ name: 'build', conclusion: 'success' }],
    changesRequestedBy: [],
    ownFixUnchecked: false,
    ...overrides,
  };
}
