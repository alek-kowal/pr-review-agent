import { useQuery } from '@tanstack/react-query';
import { costBasisOf, setCostBasis, type CostBasis } from '@/copy/format.ts';
import { statusQuery } from './status-query.ts';

/**
 * Sets what dollar amounts mean (P-25) from the status query before any page renders: on a
 * Claude subscription every amount reads "API-equivalent". `ready` once the status answered (or
 * failed: amounts then read as spend); `basis` keys the page, so a change re-renders every amount.
 */
export function useCostBasis(): { ready: boolean; basis: CostBasis } {
  const status = useQuery(statusQuery());
  const basis = costBasisOf(status.data?.modelAuth);
  setCostBasis(basis);
  return { ready: !status.isPending, basis };
}
