// KINDS: a list of instruction files shows instructions (prompts and rules) apart from documents
// (reference context such as feature maps).
import { INSTRUCTION_KINDS, type InstructionKind } from '@pra/core';

/** Documents fold away above this many rows (a repository can hold 14 feature maps). */
export const FOLD_DOCUMENTS_ABOVE = 5;

/** `items` by kind, instructions first, each kind in the given order; empty kinds are left out. */
export function groupByKind<T>(
  items: readonly T[],
  kindOf: (item: T) => InstructionKind,
): { kind: InstructionKind; items: T[] }[] {
  return INSTRUCTION_KINDS.map((kind) => ({
    kind,
    items: items.filter((item) => kindOf(item) === kind),
  })).filter((group) => group.items.length > 0);
}
