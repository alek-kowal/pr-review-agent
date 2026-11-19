// Response types of the api's read endpoints. The api's Zod schemas are the source of truth
// (apps/api/src/routes/api, apps/api/src/pr-view); the web may not import server packages.
import type {
  AgentRole,
  AlertConfig,
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

export type SensitiveStatus = 'pending' | 'approved' | 'sent_back';

/** The PR's sensitive files (`sensitive` section, S-11-T2). */
export type SensitiveView = {
  /** Sent with approve and send back; a stale one answers 409 `sensitive_stale`. */
  version: number;
  /** null when no changed file matched a sensitive pattern. */
  status: SensitiveStatus | null;
  files: { path: string; pattern: string; reason: string; status: SensitiveStatus }[];
  /** The latest send back while any file is still sent back. */
  sentBack: { by: { id: string; name: string }; comment: string; at: string } | null;
};

export type PrView = {
  pullRequest: PullRequestView;
  latestRound: RoundView | null;
  nextStep: NextStepView;
  checklist: ChecklistView;
  author: AuthorView;
  head: HeadView;
  sensitive: SensitiveView;
  roundProgress: RoundProgressView | null;
  task: TaskSectionView;
  checks: ChecksSectionView;
  /** The PR's active alerts, newest first (S-18). */
  alerts: AlertView[];
};

/** One alert (S-18): `GET /api/alerts`, Dismiss and the PR view's `alerts`. */
export type AlertView = {
  id: number;
  kind: 'failed' | 'rounds' | 'cost' | 'budget';
  status: 'active' | 'resolved' | 'dismissed';
  title: ReasonView;
  nextStep: ReasonView;
  /** The failed round (Retry from its stage); null for the other kinds. */
  runId: number | null;
  /** Null for the daily budget alert. */
  pullRequest: { repository: { slug: string }; number: number; title: string } | null;
  delivery: {
    status: 'pending' | 'sent' | 'not_configured' | 'failed';
    taskId: string | null;
    toGeneralTask: boolean;
    postedAt: string | null;
  };
  createdAt: string;
  endedAt: string | null;
  endedBy: 'bot' | 'hand' | null;
  endNote: ReasonView | null;
};

export type AlertsResponse = { alerts: AlertView[]; activeCount: number; pastCount: number };

/** `GET/PUT /api/settings/alerts` (S-21-T9). */
export type AlertSettingsResponse = { config: AlertConfig };

export type ChangeType = 'uses_existing' | 'changes_behaviour' | 'one_way_door';

/**
 * The PR's Checks and Change type from its latest completed round (S-04-T6), and the type a
 * person forced for the next round. `PUT /api/prs/:repo/:number/change-type` answers `{checks}`.
 */
export type ChecksSectionView = {
  runId: number | null;
  /** `reason.code`: `forced_by_person`, `judge_raised`, or a rules code. */
  changeType: { value: ChangeType; reason: ReasonView } | null;
  forced: ChangeType | null;
  largePr: { lines: number; threshold: number } | null;
  ci: { passed: number; failed: number; pending: number } | null;
  install: { status: string } | null;
};

/** `POST .../sensitive/approve` and `.../sensitive/send-back`: what changed on the PR page. */
export type SensitiveResult = Pick<PrView, 'nextStep' | 'checklist' | 'sensitive'>;

/** `POST /api/prs/:repo/:number/merge`: the reviewed SHA, GitHub's squash commit and the signer. */
export type MergeResponse = { sha: string; mergeSha: string; by: { id: string; name: string } };

/** A failing checklist row in 409 `merge_not_ready` (`params.items`). */
export type MergeFailingRow = Pick<ChecklistView['items'][number], 'item' | 'reason'>;

/** `POST /api/prs/:repo/:number/start-review`. */
export type StartReviewResponse = {
  runId: number;
  chainId: string;
  roundNumber: number;
  level: LevelNumber;
};

/** The PR's ClickUp task (`task` section of the PR view, S-06-T4). */
export type TaskLinkView = {
  /** As ClickUp knows it: a custom id such as `WB-123`, or the task's own id. */
  taskId: string;
  name: string;
  url: string;
  how: 'branch' | 'title' | 'search' | 'hand';
  linkedBy: ActorView['kind'];
};
export type TaskSectionView = {
  /** The repository has ClickUp settings. */
  configured: boolean;
  link: TaskLinkView | null;
};

/** A board card: `GET /api/board`. */
export type BoardCard = {
  repository: { slug: string };
  number: number;
  title: string;
  author: AuthorView;
  isDraft: boolean;
  isFork: boolean;
  openedAt: string;
  /** The level the next round starts at, and the repository's default. */
  level: { number: number; repositoryDefault: number };
  /** Completed rounds of the current chain, of `max`. */
  round: { number: number; max: number };
  nextStep: NextStepView;
  badges: ReasonView[];
  /** Active alerts on the PR; the card shows one bell when above 0. */
  alertCount: number;
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
  /** Connected repositories' slugs, for the Repository filter. */
  repositories: string[];
};

/** `GET /api/search?q=` (S-17-T5). */
export type SearchResponse = {
  pullRequests: {
    repository: { slug: string };
    number: number;
    title: string;
    author: { login: string; name: string | null };
    state: 'open' | 'closed' | 'merged';
  }[];
};

/** A finding's current decision. */
export type DecisionView = {
  /** The batch that decided it; Undo takes this id. */
  batchId: number;
  decision: Decision;
  reason: string | null;
  signedBy: { id: string; name: string };
  decidedAt: string;
  /** The PR author when it was decided (S-08-T5). */
  author: AuthorView;
  /** The names its label shows; `author` is null when the author signed it. */
  label: { signer: string; author: string | null };
  /** Defer to ClickUp only: the follow-up task, or why there is none (S-06-T5). */
  followUp: FollowUpView | null;
};

export type FollowUpView = {
  /** Null until the follow-up job ran. */
  status: 'creating' | 'created' | 'failed' | null;
  taskId: string | null;
  url: string | null;
  error: ReasonView | null;
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
  /** How Verify reached the verdict (level 3 and up); null when Verify did not run. */
  verification: {
    reason: ReasonView;
    verifierReason: string | null;
    reproduction: {
      exitCode: number | null;
      timedOut: boolean;
      outputTail: string | null;
      repaired: boolean;
    } | null;
  } | null;
  /** Sent back with a decision; a decision made in between gives 409 `decision_conflict`. */
  version: number;
  decision: DecisionView | null;
  /** Who usually decides it (the author); null when it needs no decision. */
  usuallyDecidedBy: AuthorView | null;
  needsDecision: { needed: boolean; reason: ReasonView };
  /** The head SHA of the round that found it. */
  sourceSha: string;
  /** Commits on the PR's head since `sourceSha`; 0 while the head has not moved. */
  commitsBehind: number;
  /** The newest fix check of a finding decided Implement; null before one ran. */
  fix: { resolved: boolean; reason: string; runId: number } | null;
  /** Signed opinions, oldest first (FR-037); one per signer. */
  opinions: OpinionView[];
};

export type OpinionValue = 'worth' | 'not_worth';

export type OpinionView = {
  id: number;
  signedBy: { id: string; name: string };
  value: OpinionValue;
  comment: string | null;
  /** The round it was given in; shown as "from round N" when carried. */
  fromRound: number;
  /** Copied from the matching finding of an earlier round (FR-043). */
  carried: boolean;
  at: string;
};

export type QuestionView = {
  id: number;
  ordinal: number;
  text: string;
  options: string[];
  recommended: number | null;
  why: string | null;
  /** The current answer; null while open. Its id goes back as `expectedAnswerId`. */
  answer: AnswerView | null;
};

export type AnswerView = {
  id: number;
  /** The picked option; null for an own answer. */
  option: number | null;
  text: string;
  signedBy: { id: string; name: string };
  savedAt: string;
};

/** One question of a 409 `answer_conflict`, with the answer saved in the meantime. */
export type AnswerConflict = { questionId: number; answer: AnswerView | null };

export type FindingsResponse = {
  round: {
    id: number;
    number: number | null;
    level: { number: number; key: string };
    finishedAt: string | null;
  } | null;
  /** The latest completed round, whose results this shows; a newer one waits behind a strip. */
  resultsRound: { id: number; number: number | null } | null;
  findings: FindingView[];
  questions: QuestionView[];
  notChecked: string[];
  /** Below level 3: how many findings no verifier checked; null at level 3 and up. */
  unchecked: number | null;
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

/** A signed review: the opinions one signer saved together (S-08-T4). */
export type ReviewView = {
  id: number;
  signedBy: { id: string; name: string };
  worth: number;
  notWorth: number;
  createdAt: string;
};
export type ReviewResponse = DecisionResult & { review: ReviewView };

/** Notify author (S-08-T10): the ClickUp comment for a signed review, exactly as posted. */
export type NotificationView = {
  reviewId: number;
  taskId: string;
  author: string;
  text: string;
  /** When it was posted; null until then. */
  notifiedAt: string | null;
};
export type NotificationResponse = { notification: NotificationView };

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

/**
 * `GET /api/status`, and the answer of every status change (`POST /api/status/pause`,
 * `/resume`, `PUT /api/status/budget`, `/slots`): the status chip and Budget & status.
 */
export type StatusResponse = {
  /** Paused wins over a reached budget. */
  state: 'running' | 'paused' | 'budget_reached';
  pausedBy: { id: string; name: string } | null;
  pausedReason: string | null;
  pausedAt: string | null;
  /** Null: no budget. */
  dailyBudgetUsd: number | null;
  agentSlots: number;
  timeZone: string;
  todaySpendUsd: number;
  /** Start of the day the spend counts from (local midnight in `timeZone`). */
  since: string;
  /** Rounds that wait for their start. */
  queuedCount: number;
  /** Active alerts (S-18). */
  activeAlertCount: number;
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
  /** Why the run waits: `paused`, `budget_reached` or `slots_busy`; null when it does not. */
  wait: ReasonView | null;
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
  /** A retry's copy of a stage the failed run finished (S-09-T2). */
  reused: boolean;
};

/** A run linked by retry: the failed run a retry repeats, or the retry of a failed run. */
export type LinkedRunView = { id: number; status: RunStatus; costUsd: number };

/** `POST /api/runs/:id/retry`. */
export type RetryRunResponse = { run: { id: number; fromStage: string } };

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
    instructionVersions: {
      id: number;
      scope: string;
      fileKey: string;
      version: number;
      level?: number | null;
      fileId?: number | null;
    }[];
    error: { stage: string; code: string } | null;
    /** The model of every role, frozen when the run was created. */
    models: ModelChoiceView[];
    /** The failed run this run retries, with its cost up to the failure. */
    retryOf: LinkedRunView | null;
    /** The stage this retry started from. */
    retryFrom: string | null;
    /** The run that retried this failed run. */
    retriedBy: LinkedRunView | null;
  };
  pullRequest: { repository: { slug: string }; number: number; title: string };
  /** `round_label`; null for a run that is not a round. */
  label: ReasonView | null;
  stages: RunStageView[];
  /** Sum of the run's session costs: for a failed run, what it spent up to the failure. */
  totalCostUsd: number;
};

/** `GET /api/prs/:repo/:number/timeline`. */
export type TimelineResponse = {
  summary: {
    /** First ready-for-review state; null while the PR was never ready. */
    readyAt: string | null;
    outcome: 'open' | 'merged' | 'closed';
    /** Ready → merged / closed, or open for (until now). */
    totalMs: number;
    agentsWorkedMs: number;
    waitingMs: number;
    byLane: Record<string, number>;
    /** Cost of the PR's finished runs. */
    costUsd: number;
  };
  entries: TimelineEntryView[];
};

export type TimelineEntryView = {
  id: number;
  at: string;
  actor: ActorView;
  /** The signer's name for member entries (kept after they leave the team). */
  memberName: string | null;
  kind: string;
  params: Record<string, unknown>;
  runId: number | null;
  /** A finished run's final cost. */
  costUsd: number | null;
};

/** `GET /api/settings/models` (S-21-T3): every role's model, the defaults and level overrides. */
export type ModelsResponse = {
  models: Record<AgentRole, string>;
  defaults: Record<AgentRole, string>;
  /** Levels that set their own model for a role ("Level 6 uses claude-opus-5-5"). */
  overrides: { level: LevelNumber; role: AgentRole; model: string }[];
};

/** The settings a review level resolves to (core `LevelSettings`). */
export type LevelSettingsView = {
  brief: string | null;
  maxFindings: number;
  maxQuestions: number;
  stageTimeoutMinutes: number;
  autofixMaxPatches: number | null;
};
export type LevelSettingKey = keyof LevelSettingsView;

/** One review level: what it adds, its own values, what it resolves to and where from. */
export type LevelView = {
  number: LevelNumber;
  key: string;
  adds: string[];
  /** The level's own values (`models` holds its own model per role); the rest is inherited. */
  own: Partial<LevelSettingsView> & { models?: Partial<Record<AgentRole, string>> };
  settings: LevelSettingsView;
  origins: Record<string, { level: LevelNumber; source: 'built_in' | 'override' }>;
  models: ModelChoiceView[];
};

/** `GET /api/settings/levels`. */
export type LevelsResponse = { defaultLevel: LevelNumber; levels: LevelView[] };

/** One `settings_changes` row (S-21-T6). */
export type AuditEntry = {
  id: number;
  at: string;
  area: string;
  entity: string;
  actor: 'member' | 'bot' | 'hand';
  signer: { id: string; name: string } | null;
  before: unknown;
  after: unknown;
  note: string | null;
};

/** `GET /api/audit`: a page of changes, newest first, and the filters' options. */
export type AuditResponse = {
  entries: AuditEntry[];
  nextCursor: string | null;
  areas: string[];
  signers: { id: string; name: string }[];
};

/** A role's model and where it comes from (core `ModelChoice`). */
export type ModelChoiceView = {
  role: AgentRole;
  model: string;
  /** `level`: a level override (`level` names it); `settings`: Settings → Models. */
  source: 'level' | 'settings' | 'default';
  level: number | null;
};

// Instructions (apps/api/src/routes/api/instructions).
export type InstructionScope = 'global' | 'repository' | 'level';
export type InstructionVersionStatus = 'active' | 'draft' | 'archived';

export type InstructionFileView = {
  id: number;
  scope: InstructionScope;
  repository: { id: number; slug: string } | null;
  level: LevelNumber | null;
  fileKey: string;
};

export type InstructionVersionRef = {
  id: number;
  version: number;
  note: string | null;
  createdAt: string;
  activatedAt: string | null;
};

export type InstructionsListResponse = {
  files: (InstructionFileView & {
    active: InstructionVersionRef | null;
    draft: InstructionVersionRef | null;
  })[];
};

export type InstructionVersionView = InstructionVersionRef & {
  status: InstructionVersionStatus;
  content: string;
  author: 'member' | 'bot' | 'hand';
  authorName: string | null;
  signerName: string | null;
  runCount: number;
  runs: {
    runId: number;
    kind: string;
    repositorySlug: string;
    prNumber: number;
    createdAt: string;
  }[];
};

// Trials (apps/api/src/routes/api/trials).
export type TrialStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export type TrialSummaryView = {
  id: number;
  pr: { repo: string; number: number; title: string };
  draft: { id: number; fileId: number; fileKey: string; version: number; status: string };
  status: TrialStatus;
  startedBy: 'member' | 'bot' | 'hand';
  headSha: string;
  createdAt: string;
};

export type TrialFindingView = {
  id: number;
  severity: Severity;
  title: string;
  file: string;
  line: number | null;
  verdict: Verdict;
};

export type TrialRunSide = { id: number; status: string; costUsd: number };

export type TrialsListResponse = { trials: TrialSummaryView[] };

export type TrialDetailResponse = {
  trial: TrialSummaryView & {
    runs: { a: TrialRunSide | null; b: TrialRunSide | null };
    compare: {
      onlyA: TrialFindingView[];
      onlyB: TrialFindingView[];
      both: { a: TrialFindingView; b: TrialFindingView }[];
    };
    diff: {
      fileKey: string;
      before: { version: number; content: string } | null;
      after: { version: number; content: string };
    };
  };
};

export type InstructionDetailResponse = {
  file: InstructionFileView;
  /** Newest first. */
  versions: InstructionVersionView[];
};

// The read-only pipeline (apps/api/src/routes/api/pipeline).
export type PipelineStageKey =
  'checks' | 'task' | 'change_type' | 'review' | 'verify' | 'implement' | 'fix_check' | 'analyst';

export type PipelineStageView = {
  key: PipelineStageKey;
  role: AgentRole | null;
  /** Null for a stage of plain code. */
  model: { model: string; source: 'level' | 'settings' | 'default'; level: number | null } | null;
  tools: string[];
  integrations: string[];
  /** Global files; `version` is the active one, null when the file or its active version is missing. */
  instructions: { fileKey: string; fileId: number | null; version: number | null }[];
  output: { schema: string; fields: string[] };
  timeoutMinutes: number;
  attempts: number;
  repairs: number;
  onFrom: LevelNumber;
};

export type PipelineResponse = { stages: PipelineStageView[] };
