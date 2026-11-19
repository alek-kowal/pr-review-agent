// Response builders for web tests. Shapes follow `@/lib/api-types.ts`.
import type {
  TaskSectionView,
  AuthorView,
  BoardCard,
  BoardResponse,
  ChecklistView,
  FindingView,
  FindingsResponse,
  HeadView,
  NextStepView,
  PrView,
  QuestionView,
  RepositoryRef,
  RoundProgressView,
  RoundView,
  SensitiveView,
} from '@/lib/api-types.ts';

export const aRepository = (over: Partial<RepositoryRef> = {}): RepositoryRef => ({
  slug: 'wb',
  name: 'Workflow Builder',
  githubFullName: 'synergycodes/workflowbuilder',
  ...over,
});

export const anAuthor = (over: Partial<AuthorView> = {}): AuthorView => ({
  login: 'octocat',
  memberId: null,
  name: null,
  ...over,
});

/** The Next step of a PR with `count` findings to decide; pass `over` for other states. */
export const aNextStep = (over: Partial<NextStepView> = {}): NextStepView => ({
  state: 'findings_to_decide',
  lane: 'action_needed',
  tone: 'action',
  banner: { code: 'state_findings_to_decide', params: { count: 3, reviewers: 0 } },
  who: { code: 'who_usually_author', params: { author: 'octocat' } },
  mainAction: { action: 'decide', signed: true, optional: false, disabled: null, stage: null },
  ...over,
});

export const aChecklist = (over: Partial<ChecklistView> = {}): ChecklistView => ({
  ok: false,
  items: [
    {
      item: 'review_covers_head',
      ok: true,
      reason: { code: 'checklist_review_on_head', params: { sha: 'abc1234def' } },
    },
    {
      item: 'nothing_undecided',
      ok: false,
      reason: { code: 'checklist_findings_undecided', params: { count: 3 } },
    },
  ],
  ...over,
});

let nextCardNumber = 100;
export const aBoardCard = (over: Partial<BoardCard> = {}): BoardCard => ({
  repository: { slug: 'wb' },
  number: nextCardNumber++,
  title: 'Add node grouping',
  author: anAuthor(),
  isDraft: false,
  openedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  nextStep: aNextStep(),
  badges: [],
  ...over,
});

export const anEmptyBoard = (over: Partial<BoardResponse> = {}): BoardResponse => ({
  lanes: {
    not_reviewed: { cards: [], drafts: [] },
    agents_working: { cards: [] },
    action_needed: { cards: [] },
    ready_to_merge: { cards: [] },
  },
  mergedOrClosed: [],
  repositoryCount: 1,
  ...over,
});

export const aRound = (over: Partial<RoundView> = {}): RoundView => ({
  id: 1,
  number: 1,
  status: 'completed',
  level: { number: 1, key: 'review' },
  startedBy: { kind: 'bot' },
  trigger: 'ready_for_review',
  createdAt: '2026-11-19T10:00:00.000Z',
  startedAt: '2026-11-19T10:00:01.000Z',
  finishedAt: '2026-11-19T10:03:00.000Z',
  costUsd: 0.42,
  stages: [],
  error: null,
  ...over,
});

export const aPrView = (
  over: {
    round?: RoundView | null;
    number?: number;
    nextStep?: NextStepView;
    checklist?: ChecklistView;
    author?: AuthorView;
    head?: Partial<HeadView>;
    sensitive?: Partial<SensitiveView>;
    roundProgress?: RoundProgressView | null;
    task?: TaskSectionView;
  } = {},
): PrView => ({
  pullRequest: {
    id: 7,
    repository: aRepository(),
    number: over.number ?? 12,
    title: 'Add node grouping',
    authorLogin: 'octocat',
    state: 'open',
    isDraft: false,
    isFork: false,
    headRef: 'feature/grouping',
    baseRef: 'main',
    headSha: 'abc123',
    commitsCount: 3,
    openedAt: '2026-11-18T09:00:00.000Z',
    updatedAt: '2026-11-19T09:00:00.000Z',
    githubUrl: 'https://github.com/synergycodes/workflowbuilder/pull/12',
  },
  latestRound: over.round === undefined ? aRound() : over.round,
  nextStep: over.nextStep ?? aNextStep(),
  checklist: over.checklist ?? aChecklist(),
  author: over.author ?? anAuthor(),
  head: aHead(over.head),
  sensitive: aSensitive(over.sensitive),
  roundProgress: over.roundProgress ?? null,
  task: over.task ?? { configured: true, link: null },
});

/** No sensitive file by default. */
export const aSensitive = (over: Partial<SensitiveView> = {}): SensitiveView => ({
  version: 0,
  status: null,
  files: [],
  sentBack: null,
  ...over,
});

export const aHead = (over: Partial<HeadView> = {}): HeadView => ({
  reviewedSha: 'abc123',
  headSha: 'abc123',
  commitsSince: 0,
  completedRounds: 1,
  maxRounds: 3,
  level: { pr: null, repositoryDefault: 1, next: 1 },
  fixes: null,
  ...over,
});

let nextFindingId = 1;

export const aFinding = (over: Partial<FindingView> = {}): FindingView => {
  const id = over.id ?? nextFindingId++;
  return {
    id,
    ordinal: id,
    severity: 'worth_fixing',
    title: `Finding ${id}`,
    file: 'src/nodes/group.ts',
    line: 40 + id,
    scenario: `Scenario ${id}`,
    suggestion: `Suggestion ${id}`,
    verdict: 'unchecked',
    evidence: [],
    verification: null,
    version: 0,
    decision: null,
    // Core's rule (`needsDecision` in @pra/core): decided, refuted and nit findings need none.
    needsDecision: {
      needed:
        (over.severity ?? 'worth_fixing') !== 'nit' && !over.decision && over.verdict !== 'refuted',
      reason: { code: 'unchecked_needs_person', params: { severity: 'worth_fixing' } },
    },
    sourceSha: 'abc123',
    commitsBehind: 0,
    fix: null,
    opinions: [],
    ...over,
  };
};

export const aFindingsResponse = (over: Partial<FindingsResponse> = {}): FindingsResponse => ({
  round: { id: 1, number: 1, level: { number: 1, key: 'review' }, finishedAt: null },
  findings: [],
  questions: [],
  notChecked: [],
  unchecked: null,
  ...over,
});

export const aQuestion = (over: Partial<QuestionView> = {}): QuestionView => ({
  id: 1,
  ordinal: 1,
  text: 'Should the cache survive a restart?',
  options: ['Yes', 'No'],
  recommended: 0,
  why: 'Restarts are frequent.',
  answer: null,
  ...over,
});
