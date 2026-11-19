import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { teamQuery } from './queries.ts';

/** Team names by member id, fetched only when a line needs them (`enabled`). */
export function useTeamNames(enabled: boolean): ReadonlyMap<string, string> {
  const members = useQuery({ ...teamQuery(), enabled }).data?.members;
  return useMemo(() => new Map(members?.map((m) => [m.id, m.name] as const)), [members]);
}
