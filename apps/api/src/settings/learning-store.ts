import { acceptLessonCandidate, lockLessonCandidate, rejectLessonCandidate } from '@pra/db';
import type { SettingsStore } from './signed-change.ts';

/**
 * A lesson candidate's decision as the settings log records it. Accept adds `lessonsVersion`, the
 * `lessons.md` version the lesson went into; reject adds the reason.
 */
export type LessonDecision = {
  title: string;
  text: string;
  status: 'proposed' | 'accepted' | 'rejected';
  reason?: string | null;
  lessonsVersion?: number | null;
};

/**
 * Learning in Settings (S-23-T4): one entity per lesson candidate, keyed by its id. Writing status
 * `accepted` adds the lesson to its repository's `lessons.md` as a new active version by the bot
 * (which logs its own `instructions` row); `rejected` records the reason. Both sign as `signerId`.
 */
export function learningStore(signerId: string | null): SettingsStore<LessonDecision> {
  return {
    area: 'learning',
    async read(tx, entity) {
      const row = await lockLessonCandidate(tx, Number(entity));
      if (!row) return null;
      return {
        title: row.title,
        text: row.text,
        status: row.status as LessonDecision['status'],
        reason: row.rejectReason,
        lessonsVersion: row.lessonsVersion,
      };
    },
    async write(tx, entity, after) {
      if (!signerId) throw new Error('a lesson decision needs a signer');
      const id = Number(entity);
      if (after?.status === 'accepted') {
        const accepted = await acceptLessonCandidate(tx, id, signerId);
        return {
          entity,
          value: { ...after, lessonsVersion: accepted.version.version, reason: null },
        };
      }
      if (after?.status === 'rejected' && after.reason) {
        await rejectLessonCandidate(tx, id, { reason: after.reason, memberId: signerId });
        return { entity, value: { ...after, lessonsVersion: null } };
      }
      throw new Error(`lesson candidate ${entity}: unsupported decision`);
    },
  };
}
