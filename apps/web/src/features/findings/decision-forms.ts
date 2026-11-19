// Which decision form is open on which finding (S-17-T6). The finding list holds it, so the
// triage keys `i`, `r` and `d` can open a finding's form; outside a list each row keeps its own.
import { createContext, useContext, useState } from 'react';
import type { Decision } from '@pra/core';

export type DecisionForms = {
  get: (findingId: number) => Decision | null;
  set: (findingId: number, decision: Decision | null) => void;
};

export const DecisionFormsContext = createContext<DecisionForms | null>(null);

/** The open decision form of one finding and its setter. */
export function useDecisionForm(
  findingId: number,
): [Decision | null, (decision: Decision | null) => void] {
  const shared = useContext(DecisionFormsContext);
  const [local, setLocal] = useState<Decision | null>(null);
  if (shared) return [shared.get(findingId), (decision) => shared.set(findingId, decision)];
  return [local, setLocal];
}

/** The list's state behind `DecisionFormsContext`. */
export function useDecisionFormsState(): DecisionForms {
  const [forms, setForms] = useState<ReadonlyMap<number, Decision>>(() => new Map());
  return {
    get: (findingId) => forms.get(findingId) ?? null,
    set: (findingId, decision) =>
      setForms((prev) => {
        const next = new Map(prev);
        if (decision) next.set(findingId, decision);
        else next.delete(findingId);
        return next;
      }),
  };
}
