/**
 * The PRD vocabulary. Each list is ordered where order means something
 * (severity from most to least severe, change type from lowest to highest).
 */

export const SEVERITIES = ['blocking', 'worth_fixing', 'nit'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERDICTS = ['confirmed', 'refuted', 'not_proven', 'unchecked'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const DECISIONS = ['implement', 'reject', 'defer'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Lowest to highest. The judge may only move a change type to the right. */
export const CHANGE_TYPES = ['uses_existing', 'changes_behaviour', 'one_way_door'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const LEVEL_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type LevelNumber = (typeof LEVEL_NUMBERS)[number];

/** The stages of a full round, in run order. */
export const STAGE_KEYS = ['checks', 'task', 'change_type', 'review', 'verify'] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const AGENT_ROLES = ['reviewer', 'verifier', 'implementer', 'judge', 'analyst'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Every kind of run. Trials and the analyst never change a PR's state. */
export const RUN_KINDS = ['round', 'implementer', 'trial', 'analyst'] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const ACTOR_KINDS = ['member', 'bot', 'hand'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

/** Who acted: a Team member (signed), the bot, or a person without a signature ("by hand"). */
export type Actor = { kind: 'member'; memberId: string } | { kind: 'bot' } | { kind: 'hand' };

export const BOT: Actor = Object.freeze({ kind: 'bot' });
export const HAND: Actor = Object.freeze({ kind: 'hand' });
export const member = (memberId: string): Actor => ({ kind: 'member', memberId });

export const severityRank = (severity: Severity): number => SEVERITIES.indexOf(severity);
export const changeTypeRank = (type: ChangeType): number => CHANGE_TYPES.indexOf(type);
export const isLevelNumber = (n: unknown): n is LevelNumber =>
  typeof n === 'number' && (LEVEL_NUMBERS as readonly number[]).includes(n);
