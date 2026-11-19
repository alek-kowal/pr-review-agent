// Response types of the api's read endpoints. The api's Zod schemas are the source of truth
// (apps/api/src/routes/api, apps/api/src/pr-view); the web may not import server packages.
import type {
  ChecklistItemKey,
  Decision,
  Lane,
  LevelNumber,
  MainActionCode,
  PrState,
  RepositoryConfig,
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
/** What the PR's results were measured on (`head` section, S-07-T4). */
export type HeadView = {
  /** The head SHA of the latest completed round; null before one completed. */
  reviewedSha: string | null;
  headSha: string;
  commitsSince: number;
  completedRounds: number;
  maxRounds: number;
  level: { pr: LevelNumber | null; repositoryDefault: LevelNumber; next: LevelNumber };
  /** Findings decided Implement and how many the newest fix checks found resolved. */
  fixes: { resolved: number; total: number } | null;
};

export type PrView = {
  pullRequest: PullRequestView;
  latestRound: RoundView | null;
  nextStep: NextStepView;
  checklist: ChecklistView;
  author: AuthorView;
  head: HeadView;
};

/** `POST /api/prs/:repo/:number/start-review`. */
export type StartReviewResponse = {
  runId: number;
  chainId: string;
  roundNumber: number;
  level: LevelNumber;
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
  /** The head SHA of the round that found it. */
  sourceSha: string;
  /** Commits on the PR's head since `sourceSha`; 0 while the head has not moved. */
  commitsBehind: number;
  /** The newest fix check of a finding decided Implement; null before one ran. */
  fix: { resolved: boolean; reason: string; runId: number } | null;
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

/** Every RepositoryConfig field a person sets in Settings; slug and full name come from GitHub. */
export type RepositorySettings = Omit<RepositoryConfig, 'slug' | 'githubFullName'>;

/** A connected repository: `GET /api/settings/repositories` and `/:id`. */
export type ConnectedRepository = {
  id: number;
  slug: string;
  githubFullName: string;
  installationId: number | null;
  config: RepositoryConfig;
};

/** A repository the GitHub App can reach that is not connected yet. */
export type AvailableRepository = {
  fullName: string;
  installationId: number;
  account: string;
  defaultBranch: string;
  private: boolean;
};

export type RepositoriesSettingsResponse = {
  repositories: ConnectedRepository[];
  available: AvailableRepository[];
  /** Why `available` could not be listed (e.g. `github_not_configured`); null when it was. */
  availableError: ReasonView | null;
};
export type RepositorySettingsResponse = { repository: ConnectedRepository };

/** `GET /api/settings/integrations`. */
export type IntegrationsResponse = {
  github: {
    configured: boolean;
    missing: string[];
    installations: { id: number; account: string; repositoryCount: number }[];
    repositories: { fullName: string; installationId: number; account: string; private: boolean }[];
    listError: ReasonView | null;
    deliveries: {
      last: {
        deliveryId: string;
        event: string;
        action: string | null;
        repositoryFullName: string | null;
        receivedAt: string;
        processedAt: string | null;
      } | null;
      last24h: number;
      signatureFailures24h: number;
      lastSignatureFailureAt: string | null;
    };
    lastReconcilePoll: string | null;
  };
  clickup: {
    configured: boolean;
    missing: string[];
    lastCall: { at: string; ok: boolean; error: ReasonView | null } | null;
  };
  settings: IntegrationSettings;
};
export type IntegrationSettings = { afterRoundGithubComment: boolean };

/** `POST /api/settings/integrations/clickup/test`. */
export type ClickUpTestResponse =
  { ok: true; user: { id: string; username: string } } | { ok: false; error: ReasonView };
