// Response builders for web tests. Shapes follow `@/lib/api-types.ts`.
import type {
  FindingView,
  FindingsResponse,
  PrListItem,
  PrView,
  RepositoryRef,
  RoundView,
} from '@/lib/api-types.ts';

export const aRepository = (over: Partial<RepositoryRef> = {}): RepositoryRef => ({
  slug: 'wb',
  name: 'Workflow Builder',
  githubFullName: 'synergycodes/workflowbuilder',
  ...over,
});

export const aPrListItem = (over: Partial<PrListItem> = {}): PrListItem => ({
  repository: { slug: 'wb' },
  number: 12,
  title: 'Add node grouping',
  authorLogin: 'octocat',
  isDraft: false,
  latestRoundStatus: 'completed',
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

export const aPrView = (over: { round?: RoundView | null; number?: number } = {}): PrView => ({
  pullRequest: {
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
    ...over,
  };
};

export const aFindingsResponse = (over: Partial<FindingsResponse> = {}): FindingsResponse => ({
  round: { id: 1, number: 1, level: { number: 1, key: 'review' }, finishedAt: null },
  findings: [],
  questions: [],
  notChecked: [],
  ...over,
});
