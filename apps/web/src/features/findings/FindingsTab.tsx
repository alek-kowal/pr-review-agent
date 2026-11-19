import { useQuery } from '@tanstack/react-query';
import { isActiveStatus } from '@/lib/api-types.ts';
import { findingsQuery } from '@/features/pr/queries.ts';
import type { PrTabProps } from '@/features/pr/tabs.ts';

export function FindingsTab({ repo, number, view }: PrTabProps) {
  const active = isActiveStatus(view.latestRound?.status);
  const findings = useQuery(findingsQuery(repo, number, active));
  return (
    <ul>
      {findings.data?.findings.map((f) => (
        <li key={f.id}>{f.title}</li>
      ))}
    </ul>
  );
}
