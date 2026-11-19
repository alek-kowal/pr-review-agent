// Copy for a run: its round label, the stepper and round line on the PR page, and Run detail.
import { duration, money, plural } from './format.ts';
import { shortSha } from './nextStep.ts';

type Params = Record<string, unknown>;
const n = (value: unknown): number => (typeof value === 'number' ? value : Number(value) || 0);

/** "Round 2 of 3 · started by PR Review Agent after fix abc1234", from `round_label` params. */
function roundLabel(p: Params, actor: (actor: unknown) => string): string {
  const who = p.startedBy as { kind?: string } | undefined;
  const started =
    who?.kind === 'hand'
      ? 'started by hand'
      : who?.kind === 'bot' && p.trigger === 'own_fix' && p.fixSha
        ? `started by ${actor(who)} after fix ${shortSha(p.fixSha)}`
        : `started by ${actor(who)}`;
  return [`Round ${n(p.roundNumber)} of ${n(p.max)}`, started, p.newChain ? 'new chain' : null]
    .filter(Boolean)
    .join(' · ');
}

export const runs = {
  roundLabel,
  /** A run that is not a round of a chain. */
  kinds: {
    round: (roundNumber: number | null) =>
      roundNumber === null ? 'Round' : `Round ${roundNumber} of 3`,
    trial: () => 'Trial',
    implementer: () => 'Implementer',
    analyst: () => 'Analyst',
  } as Record<string, (roundNumber: number | null) => string>,
  unknownKind: (kind: string) => kind,
  /** The round line's status part, after the label. */
  line: {
    queued: 'queued',
    running: (usd: number) => `running · ${money(usd)} so far`,
    failed: (usd: number) => `failed · ${money(usd)} up to the failure`,
    cancelled: (usd: number) => `cancelled · ${money(usd)}`,
    completed: (at: string, usd: number) => `finished ${at} · ${money(usd)}`,
  },
  roundLabelFallback: (number: number | null) => (number === null ? 'Round' : `Round ${number}`),
  stagesToggle: 'Stages',
  runDetails: 'Run details',
  stepperLabel: 'Stages of this round',
  /** A step's second line in the stepper. */
  step: {
    off: (level: number) => `off at level ${level}`,
    waiting: 'waiting',
    notRun: 'not run',
    running: 'working',
    done: 'done',
  },
  stepCost: (usd: number) => money(usd),
  stepDuration: (ms: number) => duration(ms),
  statusWords: {
    done: 'Done',
    running: 'Running',
    failed: 'Failed',
    queued: 'Not run yet',
    off: 'Off',
  } as Record<string, string>,
  detail: {
    loading: 'Loading the run…',
    notFound: 'This run does not exist.',
    backToActivity: 'Open Activity',
    breadcrumb: 'Run',
    title: (label: string, number: number) => `${label} on #${number}`,
    status: {
      queued: 'Queued',
      running: 'Running',
      completed: 'Finished',
      failed: 'Failed, not counted',
      cancelled: 'Cancelled',
    } as Record<string, string>,
    level: (level: number) => `level ${level}`,
    startedBy: (who: string) => `started by ${who}`,
    cost: {
      running: (usd: number) => `${money(usd)} so far`,
      failed: (usd: number) => `${money(usd)} up to the failure`,
      done: (usd: number) => money(usd),
    },
    failedAt: (stage: string, why: string) => `Failed at ${stage}: ${why}.`,
    tabsLabel: 'Run sections',
    tabs: { stages: 'Stages', transcript: 'Agent transcript' },
    stageCode: 'code',
    stageAgent: (models: string) => `agent · ${models}`,
    stageOff: (level: number) => `Off at level ${level}.`,
    stageQueued: (failed: boolean) =>
      failed ? 'Not run: an earlier stage failed.' : 'Not run yet.',
    stageRunning: 'Running now. Output appears when the stage finishes.',
    stageFailed: (why: string) => `Failed: ${why}. The cost up to the failure is recorded.`,
    noOutput: 'Finished without a readable output.',
    sessions: 'Agent sessions',
    session: {
      title: (role: string) => role.charAt(0).toUpperCase() + role.slice(1),
      turns: (count: number) => plural(count, 'turn'),
      filesRead: (count: number) => `${plural(count, 'file')} read`,
      actions: (count: number) => plural(count, 'action'),
      noTranscript: 'No transcript stored for this session.',
      filesHeading: 'Files read',
      actionsHeading: 'Actions',
      status: (status: string) => (status === 'completed' ? '' : status),
    },
    costPerSession: 'Cost per session',
    costPerSessionHint: 'Code stages cost nothing. Only agent sessions are billed.',
    noSessions: 'No agent sessions in this run.',
    instructionVersions: 'Instruction versions',
    instructionVersionsHint: 'Frozen when the round starts.',
    noInstructionVersions: 'No instruction files were recorded for this run.',
    instructionVersion: (scope: string, version: number) =>
      scope === 'global' ? `v${version}` : `${scope} · v${version}`,
    notChecked: 'Not checked',
    transcript: {
      loading: 'Loading the transcript…',
      empty: 'This session has no stored transcript.',
      unreadable: 'The transcript could not be read.',
      kinds: {
        text: 'says',
        tool: 'tool',
        result: 'result',
        error: 'error',
      },
      truncated: (count: number) => `… ${count} more characters`,
    },
  },
};
