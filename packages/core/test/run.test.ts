import { describe, expect, it } from 'vitest';
import {
  cancelRun,
  completeStage,
  failStage,
  nextStage,
  planRun,
  recoverAfterRestart,
  retryFromStage,
  startRun,
  startStage,
  type RunStageKey,
  type RunState,
  type Transition,
} from '../src/index.ts';

const must = (t: Transition): RunState => {
  if (!t.ok) throw new Error(`refused: ${t.reason.code}`);
  return t.run;
};
const statuses = (run: RunState) => Object.fromEntries(run.stages.map((s) => [s.key, s.status]));

/** Runs stages in order until `until` is running. */
function runUntil(run: RunState, until: RunStageKey): RunState {
  let r = must(startRun(run));
  for (let key = nextStage(r); key; key = nextStage(r)) {
    r = must(startStage(r, key));
    if (key === until) return r;
    r = must(completeStage(r, key));
  }
  return r;
}

describe('run state machine', () => {
  it('after a restart a running stage fails as interrupted and can be retried (P runs.test.ts:35)', () => {
    const running = runUntil(planRun({ kind: 'round', level: 3, roundNumber: 1 }), 'review');
    const recovered = recoverAfterRestart(running);
    expect(recovered.status).toBe('failed');
    expect(recovered.error).toEqual({ stage: 'review', code: 'interrupted' });
    expect(recovered.stages.find((s) => s.key === 'review')).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
    });
    expect(retryFromStage(recovered).ok).toBe(true);
  });

  it('after a restart queued runs stay queued (P runs.test.ts:35)', () => {
    const queued = planRun({ kind: 'round', level: 2 });
    expect(recoverAfterRestart(queued)).toEqual(queued);
    const implementer = planRun({ kind: 'implementer', level: 4 });
    expect(recoverAfterRestart(implementer).status).toBe('queued');
  });

  it('after a restart a run between stages is left as it is: the next stage job is durable (P runs.test.ts:35)', () => {
    const running = runUntil(planRun({ kind: 'round', level: 3, roundNumber: 1 }), 'review');
    const between = must(completeStage(running, 'review'));
    expect(between.status).toBe('running');
    expect(recoverAfterRestart(between)).toEqual(between);
  });

  it('runs a level 2 round to completion, skipping the stages that are off (P runs.test.ts:19)', () => {
    let run = must(startRun(planRun({ kind: 'round', level: 2, roundNumber: 1 })));
    expect(statuses(run)).toEqual({
      checks: 'pending',
      task: 'pending',
      change_type: 'pending',
      review: 'pending',
      verify: 'off',
    });
    for (const key of ['checks', 'task', 'change_type', 'review'] as const) {
      expect(nextStage(run)).toBe(key);
      run = must(completeStage(must(startStage(run, key)), key));
    }
    expect(run.status).toBe('completed');
    expect(nextStage(run)).toBeNull();
  });

  it('retry reuses the stages that succeeded, keeps the round number and counts an attempt', () => {
    const running = runUntil(planRun({ kind: 'round', level: 3, roundNumber: 2 }), 'review');
    const failed = must(failStage(running, 'review', 'timeout'));
    expect(failed.status).toBe('failed');
    expect(failed.error).toEqual({ stage: 'review', code: 'timeout' });

    const retried = must(retryFromStage(failed));
    expect(retried).toMatchObject({
      status: 'queued',
      roundNumber: 2,
      attempt: 2,
      retryFrom: 'review',
      error: null,
    });
    expect(statuses(retried)).toEqual({
      checks: 'reused',
      task: 'reused',
      change_type: 'reused',
      review: 'pending',
      verify: 'pending',
    });
    const restarted = must(startRun(retried));
    expect(nextStage(restarted)).toBe('review');
  });

  it('cancels from queued and from running', () => {
    const queued = must(cancelRun(planRun({ kind: 'round', level: 1 })));
    expect(queued.status).toBe('cancelled');

    const running = runUntil(planRun({ kind: 'implementer', level: 4 }), 'implement');
    const cancelled = must(cancelRun(running));
    expect(cancelled.status).toBe('cancelled');
    expect(statuses(cancelled)).toEqual({
      worktree: 'succeeded',
      implement: 'failed',
      reproductions: 'pending',
    });
    expect(cancelRun(cancelled)).toEqual({
      ok: false,
      reason: { code: 'run_finished', params: { status: 'cancelled' } },
    });
  });

  it('completeStage on a cancelled run returns run_not_running', () => {
    const running = runUntil(planRun({ kind: 'round', level: 1 }), 'review');
    const cancelled = must(cancelRun(running));
    expect(completeStage(cancelled, 'review')).toEqual({
      ok: false,
      reason: { code: 'run_not_running', params: { status: 'cancelled' } },
    });
  });

  it('refuses illegal transitions with a reason instead of throwing', () => {
    const queued = planRun({ kind: 'round', level: 3 });
    expect(startStage(queued, 'checks')).toEqual({
      ok: false,
      reason: { code: 'run_not_running', params: { status: 'queued' } },
    });
    const running = must(startRun(queued));
    expect(startRun(running).ok).toBe(false);
    expect(startStage(running, 'review')).toEqual({
      ok: false,
      reason: { code: 'stage_out_of_order', params: { stage: 'review', expected: 'checks' } },
    });
    expect(startStage(running, 'implement')).toEqual({
      ok: false,
      reason: { code: 'stage_not_in_plan', params: { stage: 'implement' } },
    });
    expect(completeStage(running, 'checks')).toEqual({
      ok: false,
      reason: { code: 'stage_not_running', params: { stage: 'checks', status: 'pending' } },
    });
    expect(retryFromStage(running)).toEqual({
      ok: false,
      reason: { code: 'run_not_failed', params: { status: 'running' } },
    });
    const atChecks = must(startStage(running, 'checks'));
    expect(startStage(atChecks, 'task')).toEqual({
      ok: false,
      reason: { code: 'stage_already_running', params: { stage: 'checks' } },
    });
  });

  it('plans fix checks, implementer and analyst runs with their own stages', () => {
    expect(
      planRun({ kind: 'round', level: 4, roundKind: 'fix_check' }).stages.map((s) => s.key),
    ).toEqual(['checks', 'fix_diff', 'check_fixes', 'reproductions']);
    expect(planRun({ kind: 'analyst', level: 6 }).stages.map((s) => s.key)).toEqual(['analyse']);
    expect(
      planRun({ kind: 'trial', level: 1 }).stages.find((s) => s.key === 'verify')?.offReason,
    ).toEqual({
      code: 'off_at_level',
      params: { stage: 'verify', level: 1, onFrom: 3 },
    });
  });
});
