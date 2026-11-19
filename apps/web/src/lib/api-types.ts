// Response types of the api's read endpoints. The api's Zod schemas are the source of truth
// (apps/api/src/routes/api, apps/api/src/pr-view); the web may not import server packages.
import type {
  ChecklistItemKey,
  Decision,
  Lane,
  MainActionCode,
  PrState,
  Severity,
  Tone,
  Verdict,
} from '@pra/core';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'off' | 'reused';
export type ReasonView = { code: string; params: Record<string, unknown> };
export type ActorView = { kind: 'member'; memberId: string } | { kind: 'bot' } | { kind: 'hand' };

export type RepositoryRef = { slug: string; name: string; githubFullName: string };
export type RepositoriesResponse = { repositories: RepositoryRef[] };

export type StageView = {
  key: string;
  status: StageStatus;
  attempt: number | null;
  offReason: ReasonView | null;
  errorCode: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type RoundView = {
  id: number;
  number: number | null;
  status: RunStatus;
  level: { number: number; key: string };
  startedBy: ActorView;
  trigger: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number;
  stages: StageView[];
  error: { stage: string; code: string } | null;
};

export type PullRequestView = {
  repository: RepositoryRef;
  number: number;
  title: string;
  authorLogin: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  isFork: boolean;
  headRef: string;
  baseRef: string;
  headSha: string;
  commitsCount: number;
  openedAt: string;
  updatedAt: string;
  githubUrl: string;
};

/** What is needed next, from core's state table (`nextStep`). */
export type NextStepView = {
  state: PrState;
  /** null when the PR left the board (merged or closed). */
  lane: Lane | null;
  tone: Tone;
  banner: ReasonView;
  who: ReasonView;
  mainAction: {
    action: MainActionCode;
    signed: boolean;
    optional: boolean;
    disabled: ReasonView | null;
    stage: string | null;
  } | null;
};

export type ChecklistView = {
  ok: boolean;
  items: { item: ChecklistItemKey; ok: boolean; reason: ReasonView }[];
};

/** The PR author, and the Team member with their GitHub login. */
export type AuthorView = { login: string; memberId: string | null; name: string | null };

/** `GET /api/prs/:repo/:number`: one key per PR view section. */
export type PrView = {
  pullRequest: PullRequestView;
  latestRound: RoundView | null;
  nextStep: NextStepView;
  checklist: ChecklistView;
  author: AuthorView;
};

/** A board card: `GET /api/board`. */
export type BoardCard = {
  repository: { slug: string };
  number: number;
  title: string;
  author: AuthorView;
  isDraft: boolean;
  openedAt: string;
  nextStep: NextStepView;
  badges: ReasonView[];
};

export type BoardResponse = {
  lanes: {
    not_reviewed: { cards: BoardCard[]; drafts: BoardCard[] };
    agents_working: { cards: BoardCard[] };
    action_needed: { cards: BoardCard[] };
    ready_to_merge: { cards: BoardCard[] };
  };
  mergedOrClosed: BoardCard[];
  repositoryCount: number;
};

/** A finding's current decision. */
export type DecisionView = {
  /** The batch that decided it; Undo takes this id. */
  batchId: number;
  decision: Decision;
  reason: string | null;
  signedBy: { id: string; name: string };
  decidedAt: string;
};

export type FindingView = {
  id: number;
  ordinal: number;
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  scenario: string;
  suggestion: string;
  verdict: Verdict;
  evidence: { file: string; line: number | null; quote: string }[];
  /** Sent back with a decision; a decision made in between gives 409 `decision_conflict`. */
  version: number;
  decision: DecisionView | null;
  needsDecision: { needed: boolean; reason: ReasonView };
};

export type QuestionView = {
  id: number;
  ordinal: number;
  text: string;
  options: string[];
  recommended: number | null;
  why: string | null;
};

export type FindingsResponse = {
  round: {
    id: number;
    number: number | null;
    level: { number: number; key: string };
    finishedAt: string | null;
  } | null;
  findings: FindingView[];
  questions: QuestionView[];
  notChecked: string[];
};

export const isActiveStatus = (status: RunStatus | null | undefined): boolean =>
  status === 'queued' || status === 'running';

/** An active Team member: `GET /api/team`, `POST` and `PATCH /api/team/:id`. */
export type TeamMember = {
  id: string;
  name: string;
  githubLogin: string;
  clickupUserId: string | null;
};
export type TeamResponse = { members: TeamMember[] };
export type TeamMemberResponse = { member: TeamMember };

/** `POST /api/prs/:repo/:number/decisions` and the undo: the refreshed PR view. */
export type DecisionResult = {
  nextStep: NextStepView;
  checklist: ChecklistView;
  findings: FindingsResponse;
};
export type DecideResponse = DecisionResult & { batchId: number };

/** One finding of a `decision_conflict` error: who decided it in the meantime. */
export type DecisionConflict = {
  findingId: number;
  version: number;
  decision: DecisionView | null;
};
