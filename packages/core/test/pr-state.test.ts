import { describe, expect, it } from 'vitest';
import {
  ACTION_NEEDED_ORDER,
  BOT,
  HAND,
  actionNeededOrder,
  laneOf,
  member,
  nextStep,
  prState,
  reason,
  type ActiveRun,
  type PrSnapshot,
  type PrState,
} from '../src/index.ts';
import { makeFinding, makePr, makeQuestion } from './builders.ts';

const activeRun = (overrides: Partial<ActiveRun> = {}): ActiveRun => ({
  kind: 'round',
  status: 'running',
  roundKind: 'full',
  trigger: 'manual',
  startedBy: HAND,
  roundNumber: 1,
  fixSha: null,
  retryFrom: null,
  queue: null,
  ...overrides,
});
const implementOpen = () => makeFinding({ decision: 'implement' });

interface Row {
  row: string;
  pr: Partial<PrSnapshot>;
  state: PrState;
  lane: string | null;
  banner: string;
  action: string | null;
}

// One row per line of the PRD "PR states" table.
const ROWS: Row[] = [
  {
    row: 'Draft',
    pr: { draft: true, reviewedSha: null },
    state: 'draft',
    lane: 'not_reviewed',
    banner: 'state_draft',
    action: 'start_review',
  },
  {
    row: 'Never reviewed (a fork)',
    pr: { fork: true, reviewedSha: null },
    state: 'never_reviewed',
    lane: 'not_reviewed',
    banner: 'state_never_reviewed',
    action: 'start_review',
  },
  {
    row: 'Queued',
    pr: {
      activeRun: activeRun({
        status: 'queued',
        queue: { cause: 'paused', by: member('tomek'), note: 'release freeze' },
      }),
    },
    state: 'queued',
    lane: 'agents_working',
    banner: 'state_queued_paused',
    action: 'resume',
  },
  {
    row: 'Round 1 running',
    pr: {
      reviewedSha: null,
      activeRun: activeRun({ trigger: 'ready_for_review', startedBy: BOT }),
    },
    state: 'round_running',
    lane: 'agents_working',
    banner: 'state_round_starting',
    action: 'cancel',
  },
  {
    row: 'Fix check running',
    pr: {
      activeRun: activeRun({
        roundKind: 'fix_check',
        trigger: 'own_fix',
        startedBy: BOT,
        roundNumber: 2,
        fixSha: 'fix1234',
      }),
    },
    state: 'fix_check_running',
    lane: 'agents_working',
    banner: 'state_fix_check_running',
    action: 'cancel',
  },
  {
    row: 'Questions waiting',
    pr: { questions: [makeQuestion(), makeQuestion()], findings: [makeFinding()] },
    state: 'questions_waiting',
    lane: 'action_needed',
    banner: 'state_questions_waiting',
    action: 'answer',
  },
  {
    row: 'Findings to decide',
    pr: { findings: [makeFinding(), makeFinding({ severity: 'blocking' })], reviewers: 1 },
    state: 'findings_to_decide',
    lane: 'action_needed',
    banner: 'state_findings_to_decide',
    action: 'decide',
  },
  {
    row: 'Sensitive files changed',
    pr: { sensitive: { status: 'pending', files: ['a', 'b'], sentBackBy: null } },
    state: 'sensitive_files',
    lane: 'action_needed',
    banner: 'state_sensitive_files',
    action: 'approve_sensitive',
  },
  {
    row: 'Waiting for the fix',
    pr: { level: 4, findings: [implementOpen(), implementOpen()] },
    state: 'waiting_for_fix',
    lane: 'action_needed',
    banner: 'state_waiting_for_fix',
    action: 'implement_with_agent',
  },
  {
    row: 'Fixing',
    pr: {
      findings: [implementOpen()],
      activeRun: activeRun({ kind: 'implementer', roundKind: null, startedBy: member('kasia') }),
    },
    state: 'fixing',
    lane: 'agents_working',
    banner: 'state_fixing',
    action: 'cancel',
  },
  {
    row: 'Patch ready',
    pr: {
      findings: [implementOpen()],
      patch: { status: 'ready', fixed: 2, total: 2, reproductionsPass: true, waiting: null },
    },
    state: 'patch_ready',
    lane: 'action_needed',
    banner: 'state_patch_ready',
    action: 'push',
  },
  {
    row: 'New commits since last review',
    pr: { commitsSinceReview: 3, headSha: 'def5678' },
    state: 'new_commits',
    lane: 'action_needed',
    banner: 'state_new_commits',
    action: 'start_review',
  },
  {
    row: 'Automatic rounds used',
    pr: { chainRounds: 3, findings: [implementOpen()] },
    state: 'rounds_used',
    lane: 'action_needed',
    banner: 'state_rounds_used',
    action: 'start_review',
  },
  {
    row: 'Stage failed',
    pr: {
      failedRound: { stage: 'review', errorCode: 'timeout', roundNumber: 1, timeoutMinutes: 30 },
    },
    state: 'stage_failed',
    lane: 'action_needed',
    banner: 'state_stage_failed',
    action: 'retry',
  },
  {
    row: 'Ready to merge',
    pr: {},
    state: 'ready_to_merge',
    lane: 'ready_to_merge',
    banner: 'state_ready_to_merge',
    action: 'merge',
  },
  {
    row: 'Merged or closed',
    pr: { state: 'merged', closedBy: member('kasia') },
    state: 'merged',
    lane: null,
    banner: 'state_merged',
    action: null,
  },
];

describe('PR state table', () => {
  it.each(ROWS)('$row', ({ pr, state, lane, banner, action }) => {
    const step = nextStep(makePr(pr));
    expect(step.state).toBe(state);
    expect(step.lane).toBe(lane);
    expect(laneOf(state)).toBe(lane);
    expect(step.banner.code).toBe(banner);
    expect(step.mainAction?.action ?? null).toBe(action);
  });

  it('gives banners their params: counts, sha, signer and round n of 3', () => {
    const decide = nextStep(makePr(ROWS[6]!.pr));
    expect(decide.banner).toEqual({
      code: 'state_findings_to_decide',
      params: { count: 2, reviewers: 1 },
    });
    expect(decide.who).toEqual({ code: 'who_usually_author', params: { author: 'kasia' } });
    expect(decide.mainAction).toMatchObject({ action: 'decide', signed: true });

    expect(nextStep(makePr(ROWS[4]!.pr)).banner).toEqual({
      code: 'state_fix_check_running',
      params: { fixSha: 'fix1234', roundNumber: 2, max: 3 },
    });
    expect(nextStep(makePr(ROWS[11]!.pr)).banner).toEqual({
      code: 'state_new_commits',
      params: { count: 3, reviewedSha: 'abc1234' },
    });
    expect(nextStep(makePr(ROWS[2]!.pr)).banner).toEqual({
      code: 'state_queued_paused',
      params: { by: { kind: 'member', memberId: 'tomek' }, note: 'release freeze' },
    });
    expect(nextStep(makePr()).banner).toEqual({
      code: 'state_ready_to_merge',
      params: { sha: 'abc1234' },
    });
    expect(nextStep(makePr(ROWS[13]!.pr))).toMatchObject({
      tone: 'failed',
      banner: {
        code: 'state_stage_failed',
        params: { stage: 'review', errorCode: 'timeout', timeoutMinutes: 30, roundNumber: 1 },
      },
      mainAction: { action: 'retry', signed: false, stage: 'review' },
    });
  });

  it('covers the banner variants of one state', () => {
    const budget = activeRun({
      status: 'queued',
      queue: { cause: 'budget', spentUsd: 50, budgetUsd: 50 },
    });
    expect(nextStep(makePr({ activeRun: budget })).banner.code).toBe('state_queued_budget');
    const slot = activeRun({ status: 'queued', queue: { cause: 'slot' } });
    expect(nextStep(makePr({ activeRun: slot }))).toMatchObject({
      banner: { code: 'state_queued_slot' },
      who: { code: 'who_starts_by_itself' },
      mainAction: { action: 'cancel' },
    });
    expect(nextStep(makePr({ activeRun: activeRun() })).banner.code).toBe(
      'state_round_running_by_hand',
    );
    expect(nextStep(makePr({ activeRun: activeRun({ retryFrom: 'review' }) })).banner).toEqual({
      code: 'state_round_retrying',
      params: { stage: 'review', roundNumber: 1, max: 3 },
    });
    const sensitive = reason('patch_touches_sensitive', { path: 'a', pattern: 'a' });
    const autofix = {
      status: 'ready',
      fixed: 1,
      total: 1,
      reproductionsPass: true,
      waiting: sensitive,
    } as const;
    expect(nextStep(makePr({ patch: autofix })).banner).toEqual({
      code: 'state_autofix_waiting',
      params: { reason: sensitive },
    });
    const sentBack = { status: 'sent_back', files: ['a'], sentBackBy: member('tomek') } as const;
    expect(nextStep(makePr({ sensitive: sentBack }))).toMatchObject({
      banner: { code: 'state_sensitive_sent_back', params: { count: 1 } },
      who: { code: 'who_usually_author' },
    });
    expect(nextStep(makePr({ state: 'closed' }))).toMatchObject({ state: 'closed', lane: null });
    expect(nextStep(makePr({ draft: true, reviewedSha: null })).mainAction).toMatchObject({
      action: 'start_review',
      optional: true,
    });
  });

  it('disables Implement with agent below level 4, with the reason', () => {
    const step = nextStep(makePr({ level: 3, findings: [implementOpen()] }));
    expect(step.mainAction).toEqual({
      action: 'implement_with_agent',
      signed: true,
      optional: false,
      disabled: { code: 'implement_below_level', params: { level: 3, need: 4 } },
      stage: null,
    });
  });
});

describe('state precedence', () => {
  it('an active run beats a failure', () => {
    const failedRound = {
      stage: 'review',
      errorCode: 'timeout',
      roundNumber: 1,
      timeoutMinutes: 30,
    } as const;
    expect(prState(makePr({ failedRound, activeRun: activeRun() }))).toBe('round_running');
  });

  it('questions beat findings to decide', () => {
    const pr = makePr({ questions: [makeQuestion()], findings: [makeFinding()] });
    expect(prState(pr)).toBe('questions_waiting');
    expect(nextStep(pr).banner).toEqual({
      code: 'state_questions_waiting',
      params: { count: 1, toDecideAfter: 1 },
    });
  });

  it("the bot's unchecked fix after 3 rounds holds the PR even with no finding to fix", () => {
    expect(prState(makePr({ chainRounds: 3, findings: [], ownFixUnchecked: true }))).toBe(
      'rounds_used',
    );
    expect(prState(makePr({ chainRounds: 3, findings: [], ownFixUnchecked: false }))).toBe(
      'ready_to_merge',
    );
  });

  it('Implement findings still open after 3 completed rounds give rounds_used', () => {
    expect(prState(makePr({ chainRounds: 2, findings: [implementOpen()] }))).toBe(
      'waiting_for_fix',
    );
    const step = nextStep(makePr({ chainRounds: 3, findings: [implementOpen()] }));
    expect(step.state).toBe('rounds_used');
    expect(step.banner).toEqual({
      code: 'state_rounds_used',
      params: { used: 3, max: 3, open: 1 },
    });
  });

  it('new commits beat findings still open from the reviewed commit', () => {
    expect(prState(makePr({ commitsSinceReview: 1, findings: [makeFinding()] }))).toBe(
      'new_commits',
    );
  });

  it('a trial or analyst run leaves the state untouched', () => {
    expect(prState(makePr({ activeRun: activeRun({ kind: 'trial' }) }))).toBe('ready_to_merge');
    expect(prState(makePr({ activeRun: activeRun({ kind: 'analyst' }) }))).toBe('ready_to_merge');
  });

  it('a refuted finding or a nit leaves the PR ready to merge', () => {
    const pr = makePr({
      findings: [makeFinding({ verdict: 'refuted' }), makeFinding({ severity: 'nit' })],
    });
    expect(prState(pr)).toBe('ready_to_merge');
  });

  it('orders Action needed: failed, questions, decide, sensitive, patch, fix, new commits, rounds used', () => {
    expect(ACTION_NEEDED_ORDER).toEqual([
      'stage_failed',
      'questions_waiting',
      'findings_to_decide',
      'sensitive_files',
      'patch_ready',
      'waiting_for_fix',
      'new_commits',
      'rounds_used',
    ]);
    const states: PrState[] = ['rounds_used', 'patch_ready', 'stage_failed', 'new_commits'];
    expect([...states].sort(actionNeededOrder)).toEqual([
      'stage_failed',
      'patch_ready',
      'new_commits',
      'rounds_used',
    ]);
  });
});
