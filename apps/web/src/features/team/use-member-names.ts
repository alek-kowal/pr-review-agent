import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { teamQuery } from './queries.ts';

/** Team member id → name, for naming who started or signed something; empty until loaded. */
export function useMemberNames(): ReadonlyMap<string, string> {
  const team = useQuery(teamQuery());
  return useMemo(
    () => new Map((team.data?.members ?? []).map((member) => [member.id, member.name])),
    [team.data],
  );
}
