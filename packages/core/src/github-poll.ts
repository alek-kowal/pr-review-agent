// P-28: GitHub without the App. Which mode the env selects, the poll schedule (a window of local
// hours on chosen weekdays in one time zone), and which webhook action a change of a PR between
// two polls stands for. Pure: time zones come from `Intl`, no Node API.
import './reasons/github.ts';
import type { GitHubPollSchedule } from './config.ts';

/**
 * `app`: the GitHub App (webhooks, reads and writes). `token`: a personal token, reads only.
 * `anonymous`: no credentials, reads of public repositories only, 60 requests per hour.
 */
export const GITHUB_MODES = ['app', 'token', 'anonymous'] as const;
export type GitHubMode = (typeof GITHUB_MODES)[number];

/** The App's env vars; all three select App mode. Names only: values live in `.env`. */
export const GITHUB_APP_ENV = [
  'GITHUB_APP_ID',
  'GITHUB_APP_PRIVATE_KEY_PATH',
  'GITHUB_WEBHOOK_SECRET',
] as const;
/** The personal token of token mode. */
export const GITHUB_TOKEN_ENV = 'GITHUB_TOKEN';

const isSet = (value: string | undefined): value is string => !!value && value.trim() !== '';

/**
 * App mode when every App value is set; otherwise token mode with `GITHUB_TOKEN`, else anonymous.
 * A partly set App falls back to polling, so a half-done switch-over does not go silent.
 */
export function githubModeOf(env: Readonly<Record<string, string | undefined>>): GitHubMode {
  if (GITHUB_APP_ENV.every((name) => isSet(env[name]))) return 'app';
  return isSet(env[GITHUB_TOKEN_ENV]) ? 'token' : 'anonymous';
}

/** Only the App writes to GitHub; token and anonymous mode read. */
export const githubReadOnly = (mode: GitHubMode): boolean => mode !== 'app';

/** The poller runs in token and anonymous mode; with the App, webhooks bring the events. */
export const githubPolls = (mode: GitHubMode): boolean => mode !== 'app';

/** A cron tick may come this much early and still run the poll (ticks land on whole minutes). */
export const POLL_DUE_TOLERANCE_MS = 30_000;

type LocalTime = { year: number; month: number; day: number; minutes: number; weekday: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

function wallClock(timeZone: string, at: Date) {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** The wall-clock time at `at` in `timeZone`. */
export function localTime(timeZone: string, at: Date): LocalTime {
  const p = wallClock(timeZone, at);
  const sunday0 = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    minutes: p.hour * 60 + p.minute,
    weekday: sunday0 === 0 ? 7 : sunday0,
  };
}

/** Minutes the zone is ahead of UTC at `at` (120 for Warsaw in summer). */
function offsetMinutes(timeZone: string, at: Date): number {
  const p = wallClock(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The instant a wall-clock time has in `timeZone`. A time skipped by a DST jump resolves to the
 * instant after the jump.
 */
export function zonedTime(
  timeZone: string,
  date: { year: number; month: number; day: number },
  minutes: number,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  const first = guess - offsetMinutes(timeZone, new Date(guess)) * 60_000;
  const second = guess - offsetMinutes(timeZone, new Date(first)) * 60_000;
  return new Date(Math.max(first, second));
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

/** Whether `at` falls inside the poll window: a chosen weekday, from `from` up to `to`. */
export function pollWindowOpen(schedule: GitHubPollSchedule, at: Date): boolean {
  const local = localTime(schedule.timeZone, at);
  if (!schedule.days.includes(local.weekday)) return false;
  return local.minutes >= minutesOf(schedule.from) && local.minutes < minutesOf(schedule.to);
}

/** The first window start strictly after `after`, or at it. */
function nextWindowStart(schedule: GitHubPollSchedule, after: Date): Date {
  const start = minutesOf(schedule.from);
  const local = localTime(schedule.timeZone, after);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    const date = {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
    };
    const sunday0 = day.getUTCDay();
    if (!schedule.days.includes(sunday0 === 0 ? 7 : sunday0)) continue;
    const at = zonedTime(schedule.timeZone, date, start);
    if (at.getTime() >= after.getTime()) return at;
  }
  // `days` is never empty, so a week always holds a window start.
  throw new Error('poll schedule without a window');
}

/**
 * When the next scheduled poll is due: `interval` after the last poll (or now, without one),
 * moved to the next window start when that falls outside the window.
 */
export function nextPollAt(schedule: GitHubPollSchedule, now: Date, lastPollAt: Date | null): Date {
  const earliest = lastPollAt
    ? new Date(Math.max(lastPollAt.getTime() + schedule.intervalMinutes * 60_000, now.getTime()))
    : now;
  return pollWindowOpen(schedule, earliest) ? earliest : nextWindowStart(schedule, earliest);
}

/** Whether a scheduled poll should run at `now` (a tick slightly early still counts). */
export function pollDue(schedule: GitHubPollSchedule, now: Date, lastPollAt: Date | null): boolean {
  const due = nextPollAt(schedule, now, lastPollAt);
  return due.getTime() - POLL_DUE_TOLERANCE_MS <= now.getTime() && pollWindowOpen(schedule, due);
}

/** What the poller keeps of a PR between polls. */
export type PolledPrState = {
  headSha: string;
  isDraft: boolean;
  state: 'open' | 'closed' | 'merged';
};

/** The `pull_request` webhook actions the poller can stand in for. */
export type PolledAction =
  'opened' | 'reopened' | 'synchronize' | 'ready_for_review' | 'converted_to_draft' | 'closed';

/**
 * The webhook actions a change between two polls stands for, in the order GitHub would send them.
 * `previous` null: a PR first seen after the baseline (opened). Nothing changed: none.
 */
export function pollTransitions(
  previous: PolledPrState | null,
  current: PolledPrState,
): PolledAction[] {
  if (!previous) return current.state === 'open' ? ['opened'] : [];
  if (current.state !== 'open') return previous.state === 'open' ? ['closed'] : [];
  if (previous.state !== 'open') return ['reopened'];
  const actions: PolledAction[] = [];
  if (previous.headSha !== current.headSha) actions.push('synchronize');
  if (previous.isDraft !== current.isDraft) {
    actions.push(current.isDraft ? 'converted_to_draft' : 'ready_for_review');
  }
  return actions;
}

/** A baseline older than this is taken again (a switch back from App mode after a long while). */
export const POLL_BASELINE_STALE_MS = 7 * 24 * 60 * 60 * 1000;
