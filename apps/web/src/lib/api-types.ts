// Response types of the api's read endpoints. The api's Zod schemas are the source of truth
// (apps/api/src/routes/api, apps/api/src/pr-view); the web may not import server packages.
import type {
  ChecklistItemKey,
  Decision,
  Lane,
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
  id: number;
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

/** A step of the PR page's stepper (core `stepperModel`). */
export type RoundStepView = {
  key: string;
  status: RunStepStatus;
  /** Every attempt of the stage. */
  costUsd: number;
  errorCode: string | null;
  offReason: ReasonView | null;
  startedAt: string | null;
  finishedAt: string | null;
};

/** The latest round's stepper and label; the cost grows per agent turn. */
export type RoundProgressView = {
  runId: number;
  /** `round_label`. */
  label: ReasonView | null;
  steps: RoundStepView[];
  current: string | null;
  costUsd: number;
};

/** `GET /api/prs/:repo/:number`: one key per PR view section. */
export type PrView = {
  pullRequest: PullRequestView;
  latestRound: RoundView | null;
  nextStep: NextStepView;
  checklist: ChecklistView;
  author: AuthorView;
  roundProgress: RoundProgressView | null;
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

/** `GET /api/status`: the status chip. Paused and budget states arrive with S-10. */
export type StatusResponse = {
  state: 'running' | (string & {});
  todaySpendUsd: number;
  /** Start of the day the spend counts from. */
  since: string;
};

/** `GET /api/activity/in-progress`: queued and running runs, oldest first. */
export type InProgressRun = {
  id: number;
  kind: string;
  status: RunStatus;
  roundNumber: number | null;
  level: { number: number; key: string };
  /** The running stage, or the next one between two stages; null while queued. */
  currentStage: string | null;
  /** Grows per agent turn while a session runs. */
  costUsd: number;
  createdAt: string;
  startedAt: string | null;
  pullRequest: { repository: { slug: string }; number: number; title: string };
};
export type InProgressResponse = { runs: InProgressRun[] };

export type RunStepStatus = 'done' | 'running' | 'failed' | 'queued' | 'off';

/** An agent session of a run (`GET /api/runs/:id`). */
export type RunSessionView = {
  id: number;
  role: string;
  model: string;
  status: string;
  costUsd: number;
  costSource: string;
  turns: number | null;
  durationMs: number | null;
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /** Paths the session read; empty when its transcript is not stored. */
  filesRead: string[];
  actions: { tool: string; target: string | null }[];
  hasTranscript: boolean;
};

export type RunStageView = {
  key: string;
  status: RunStepStatus;
  attempt: number | null;
  /** Every attempt of the stage. */
  costUsd: number;
  errorCode: string | null;
  offReason: ReasonView | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** The latest attempt's stored output (the stage's readable result). */
  output: unknown;
  sessions: RunSessionView[];
};

/** `GET /api/runs/:id`. */
export type RunDetail = {
  run: {
    id: number;
    kind: string;
    status: RunStatus;
    level: { number: number; key: string };
    startedBy: ActorView;
    trigger: string;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    currentStage: string | null;
    notChecked: string[];
    instructionVersions: { id: number; scope: string; fileKey: string; version: number }[];
    error: { stage: string; code: string } | null;
  };
  pullRequest: { repository: { slug: string }; number: number; title: string };
  /** `round_label`; null for a run that is not a round. */
  label: ReasonView | null;
  stages: RunStageView[];
  /** Sum of the run's session costs: for a failed run, what it spent up to the failure. */
  totalCostUsd: number;
};
