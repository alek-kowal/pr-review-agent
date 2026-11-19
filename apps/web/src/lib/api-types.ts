// Response types of the api's read endpoints. The api's Zod schemas are the source of truth
// (apps/api/src/routes/api, apps/api/src/pr-view); the web may not import server packages.
import type { Severity, Verdict } from '@pra/core';

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StageStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'off' | 'reused';
export type ReasonView = { code: string; params: Record<string, unknown> };
export type ActorView = { kind: 'member'; memberId: string } | { kind: 'bot' } | { kind: 'hand' };

export type RepositoryRef = { slug: string; name: string; githubFullName: string };
export type RepositoriesResponse = { repositories: RepositoryRef[] };

export type PrListItem = {
  repository: { slug: string };
  number: number;
  title: string;
  authorLogin: string;
  isDraft: boolean;
  latestRoundStatus: RunStatus | null;
};
export type PrListResponse = { pullRequests: PrListItem[] };

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

/** `GET /api/prs/:repo/:number`: one key per PR view section. */
export type PrView = {
  pullRequest: PullRequestView;
  latestRound: RoundView | null;
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
