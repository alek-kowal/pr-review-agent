// Response types of the Insights endpoints (S-19). The api's Zod schemas in
// apps/api/src/routes/api/insights are the source of truth; the web may not import them.

export type Range = 14 | 30;

type Sample = { sampleSize: number; tooFew: boolean };
export type Lanes = { agentsWorking: number; actionNeeded: number; readyToMerge: number };

export type OverviewPr = {
  repository: string;
  number: number;
  title: string;
  author: string;
  outcome: 'merged' | 'closed';
  finishedAt: string;
  readyToMergeMs: number | null;
  lanes: Lanes | null;
  agentWorkMs: number;
  costUsd: number;
  rounds: number;
  chainUsedUp: boolean;
  changedAfterReady: boolean | null;
  ignoredBaseMerges: number;
};

export type OverviewResponse = {
  range: Range;
  since: string;
  authors: string[];
  metrics: {
    agentWork: { valueMs: number | null } & Sample;
    readyToMerge: { valueMs: number | null; lanes: Lanes } & Sample;
    cost: {
      valueUsd: number | null;
      tokens: number;
      trialCostUsd: number;
      analystCostUsd: number;
    } & Sample;
    roundsUsedUp: { count: number; overThreeRounds: number } & Sample;
    changedAfterReady: { count: number; ignoredBaseMerges: number } & Sample;
  };
  prs: OverviewPr[];
};

export type CostResponse = {
  range: Range;
  since: string;
  totalUsd: number;
  byDay: { day: string; costUsd: number }[];
  byRepository: { repository: string; costUsd: number }[];
  byRole: { role: string; costUsd: number }[];
  byLevel: { level: number; costUsd: number }[];
  separate: { trial: number; analyst: number };
  today: { spentUsd: number; budgetUsd: number | null };
  averageRoundUsd: number | null;
};

export type QualityRates = {
  findings: number;
  decided: number;
  unchecked: boolean;
  tooFew: boolean;
  confirmedRate: number | null;
  refutedRate: number | null;
  implementShare: number | null;
};

export type QualityResponse = {
  range: Range;
  since: string;
  levels: ({ level: number; rounds: number; averageRoundUsd: number | null } & QualityRates)[];
  versions: ({
    instruction: {
      id: number;
      scope: 'global' | 'repository';
      repository: string | null;
      fileKey: string;
      version: number;
      active: boolean;
    } | null;
    runs: number;
    averageCostUsd: number | null;
  } & QualityRates)[];
};

export type TrustResponse = {
  repositories: ({
    repositoryId: number;
    repository: string;
    level: number;
    since: string;
    days: number;
    rounds: number;
  } & QualityRates)[];
};
