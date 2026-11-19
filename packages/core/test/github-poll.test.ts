import { describe, expect, it } from 'vitest';
import {
  AppSettingsSchema,
  autofixMode,
  canPush,
  DEFAULT_GITHUB_POLL_SCHEDULE,
  GitHubPollScheduleSchema,
  githubModeOf,
  githubPolls,
  githubReadOnly,
  localTime,
  nextPollAt,
  pollDue,
  pollTransitions,
  pollWindowOpen,
  zonedTime,
  type GitHubPollSchedule,
  type PolledPrState,
} from '../src/index.ts';

const schedule: GitHubPollSchedule = DEFAULT_GITHUB_POLL_SCHEDULE;
const at = (iso: string) => new Date(iso);

describe('githubModeOf', () => {
  const app = {
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY_PATH: '/k.pem',
    GITHUB_WEBHOOK_SECRET: 's',
  };

  it('picks the App when all three App values are set, even with a token', () => {
    expect(githubModeOf({ ...app, GITHUB_TOKEN: 't' })).toBe('app');
  });

  it('picks token mode with a token and no complete App', () => {
    expect(githubModeOf({ GITHUB_TOKEN: 't' })).toBe('token');
    expect(githubModeOf({ GITHUB_APP_ID: '1', GITHUB_TOKEN: 't' })).toBe('token');
  });

  it('reads anonymously with neither', () => {
    expect(githubModeOf({})).toBe('anonymous');
    expect(githubModeOf({ GITHUB_TOKEN: '  ' })).toBe('anonymous');
  });

  it('is read-only and polls only without the App', () => {
    expect([githubReadOnly('app'), githubPolls('app')]).toEqual([false, false]);
    expect([githubReadOnly('token'), githubPolls('token')]).toEqual([true, true]);
    expect([githubReadOnly('anonymous'), githubPolls('anonymous')]).toEqual([true, true]);
  });
});

describe('poll schedule', () => {
  it('defaults to every 5 minutes, 9:00–17:00, Monday to Friday, Europe/Warsaw', () => {
    expect(schedule).toEqual({
      intervalMinutes: 5,
      from: '09:00',
      to: '17:00',
      days: [1, 2, 3, 4, 5],
      timeZone: 'Europe/Warsaw',
    });
    expect(AppSettingsSchema.parse({}).githubPoll).toEqual(schedule);
  });

  it('refuses an empty window, an unknown zone and no days', () => {
    expect(GitHubPollScheduleSchema.safeParse({ from: '17:00', to: '09:00' }).success).toBe(false);
    expect(GitHubPollScheduleSchema.safeParse({ timeZone: 'Mars/Base' }).success).toBe(false);
    expect(GitHubPollScheduleSchema.safeParse({ days: [] }).success).toBe(false);
    expect(GitHubPollScheduleSchema.parse({ days: [5, 1, 5] }).days).toEqual([1, 5]);
  });

  it('opens the window by local time in the zone, not UTC', () => {
    // Winter, UTC+1: 08:30 UTC is 09:30 in Warsaw.
    expect(pollWindowOpen(schedule, at('2026-01-14T08:30:00Z'))).toBe(true);
    expect(pollWindowOpen(schedule, at('2026-01-14T07:59:00Z'))).toBe(false);
    // 16:59 local is in, 17:00 local is out.
    expect(pollWindowOpen(schedule, at('2026-01-14T15:59:00Z'))).toBe(true);
    expect(pollWindowOpen(schedule, at('2026-01-14T16:00:00Z'))).toBe(false);
    // Saturday.
    expect(pollWindowOpen(schedule, at('2026-01-17T10:00:00Z'))).toBe(false);
    // In New York the same instant is 03:30.
    const ny = { ...schedule, timeZone: 'America/New_York' };
    expect(pollWindowOpen(ny, at('2026-01-14T08:30:00Z'))).toBe(false);
  });

  it('polls every interval inside the window', () => {
    const last = at('2026-01-14T09:00:00Z');
    expect(nextPollAt(schedule, at('2026-01-14T09:01:00Z'), last)).toEqual(
      at('2026-01-14T09:05:00Z'),
    );
    expect(pollDue(schedule, at('2026-01-14T09:02:00Z'), last)).toBe(false);
    expect(pollDue(schedule, at('2026-01-14T09:05:00Z'), last)).toBe(true);
    // A tick a few seconds early still runs.
    expect(pollDue(schedule, at('2026-01-14T09:04:45Z'), last)).toBe(true);
    expect(pollDue(schedule, at('2026-01-14T09:10:00Z'), null)).toBe(true);
  });

  it('waits for the next window start after the end of a Friday', () => {
    // Friday 16:58 Warsaw (winter): next is Monday 09:00 local = 08:00 UTC.
    const last = at('2026-01-16T15:58:00Z');
    expect(nextPollAt(schedule, at('2026-01-16T15:59:00Z'), last)).toEqual(
      at('2026-01-19T08:00:00Z'),
    );
    expect(pollDue(schedule, at('2026-01-17T12:00:00Z'), last)).toBe(false);
  });

  it('keeps 09:00 local across the spring DST change', () => {
    // Warsaw moves to UTC+2 on Sunday 2026-03-29. Friday 27th 09:00 is 08:00 UTC; Monday 30th
    // 09:00 is 07:00 UTC.
    expect(nextPollAt(schedule, at('2026-03-27T07:30:00Z'), null)).toEqual(
      at('2026-03-27T08:00:00Z'),
    );
    const fridayEnd = at('2026-03-27T15:59:00Z');
    expect(nextPollAt(schedule, fridayEnd, fridayEnd)).toEqual(at('2026-03-30T07:00:00Z'));
    expect(pollWindowOpen(schedule, at('2026-03-30T07:00:00Z'))).toBe(true);
    expect(pollWindowOpen(schedule, at('2026-03-30T06:59:00Z'))).toBe(false);
  });

  it('keeps 09:00 local across the autumn DST change', () => {
    // Back to UTC+1 on Sunday 2026-10-25: Monday 26th 09:00 is 08:00 UTC.
    const fridayEnd = at('2026-10-23T14:59:00Z');
    expect(nextPollAt(schedule, fridayEnd, fridayEnd)).toEqual(at('2026-10-26T08:00:00Z'));
  });

  it('resolves wall-clock times inside a DST jump after the jump', () => {
    // 02:30 does not exist in Warsaw on 2026-03-29; it becomes 03:30 (01:30 UTC).
    expect(zonedTime('Europe/Warsaw', { year: 2026, month: 3, day: 29 }, 150)).toEqual(
      at('2026-03-29T01:30:00Z'),
    );
    expect(localTime('Europe/Warsaw', at('2026-03-29T01:30:00Z'))).toMatchObject({
      minutes: 210,
      weekday: 7,
    });
  });

  it('polls on a weekend day when the days include it', () => {
    const everyDay = { ...schedule, days: [1, 2, 3, 4, 5, 6, 7] };
    expect(pollWindowOpen(everyDay, at('2026-01-17T10:00:00Z'))).toBe(true);
  });
});

describe('pollTransitions', () => {
  const pr = (over: Partial<PolledPrState> = {}): PolledPrState => ({
    headSha: 'a1',
    isDraft: false,
    state: 'open',
    ...over,
  });

  it('maps each change to the webhook action GitHub would send', () => {
    expect(pollTransitions(null, pr())).toEqual(['opened']);
    expect(pollTransitions(null, pr({ isDraft: true }))).toEqual(['opened']);
    expect(pollTransitions(pr({ isDraft: true }), pr())).toEqual(['ready_for_review']);
    expect(pollTransitions(pr(), pr({ isDraft: true }))).toEqual(['converted_to_draft']);
    expect(pollTransitions(pr(), pr({ headSha: 'b2' }))).toEqual(['synchronize']);
    expect(pollTransitions(pr(), pr({ state: 'closed' }))).toEqual(['closed']);
    expect(pollTransitions(pr(), pr({ state: 'merged' }))).toEqual(['closed']);
    expect(pollTransitions(pr({ state: 'closed' }), pr())).toEqual(['reopened']);
  });

  it('sends the push before ready when both changed in one interval', () => {
    expect(pollTransitions(pr({ isDraft: true }), pr({ headSha: 'b2' }))).toEqual([
      'synchronize',
      'ready_for_review',
    ]);
  });

  it('sends nothing when nothing changed or a closed PR stays closed', () => {
    expect(pollTransitions(pr(), pr())).toEqual([]);
    expect(pollTransitions(pr({ state: 'closed' }), pr({ state: 'merged' }))).toEqual([]);
    expect(pollTransitions(null, pr({ state: 'closed' }))).toEqual([]);
  });
});

describe('read-only gates', () => {
  it('turns level 5 autofix into the shadow without the App', () => {
    expect(autofixMode(5)).toBe('act');
    expect(autofixMode(5, true)).toBe('shadow');
    expect(autofixMode(4, true)).toBe('shadow');
    expect(autofixMode(2, true)).toBe('off');
  });

  it('refuses a push without the App before any other rule', () => {
    const gate = canPush(
      { status: 'ready', baseSha: 'a1', files: 1 },
      { number: 7, state: 'open', fork: true, activeRun: null, githubReadOnly: true },
      7,
      'a1',
    );
    expect(gate).toEqual({ allowed: false, reason: { code: 'github_read_only', params: {} } });
  });
});
