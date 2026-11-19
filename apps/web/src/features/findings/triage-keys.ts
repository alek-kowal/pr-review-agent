// Keyboard triage on the Findings tab (S-17-T6): `j`/`k` move, `o` expands or collapses, `x`
// selects, `w`/`n` toggle the opinion draft and `i`/`r`/`d` open a decision form. The list
// ignores them while someone types or a dialog is open (`ignoreSingleKey`).
import { DECISIONS, type Decision } from '@pra/core';
import type { OpinionValue } from '@/lib/api-types.ts';
import { OPINION_KEYS, OPINION_VALUES } from '@/features/opinions/opinion-ui.ts';
import { DECISION_KEYS } from './decision-ui.ts';

export type TriageCommand =
  | { kind: 'move'; id: number }
  | { kind: 'toggle'; id: number }
  | { kind: 'select'; id: number }
  | { kind: 'opinion'; id: number; value: OpinionValue }
  | { kind: 'form'; id: number; decision: Decision };

/**
 * What `key` does on a list of finding `ids` (in the order shown) whose focused finding is
 * `current`. `j`/`k` start at the first finding; the other keys need a focused finding, and all
 * but `o` need a PR that can still be decided. Null when the key does nothing.
 */
export function triageCommand(
  key: string,
  ids: readonly number[],
  current: number | null,
  decidable: boolean,
): TriageCommand | null {
  const at = current === null ? -1 : ids.indexOf(current);
  if (key === 'j' || key === 'k') {
    if (ids.length === 0) return null;
    const next = at === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, at + (key === 'j' ? 1 : -1)));
    return { kind: 'move', id: ids[next]! };
  }
  const id = ids[at];
  if (id === undefined) return null;
  if (key === 'o') return { kind: 'toggle', id };
  if (!decidable) return null;
  if (key === 'x') return { kind: 'select', id };
  const value = OPINION_VALUES.find((v) => OPINION_KEYS[v] === key);
  if (value) return { kind: 'opinion', id, value };
  const decision = DECISIONS.find((d) => DECISION_KEYS[d] === key);
  if (decision) return { kind: 'form', id, decision };
  return null;
}
