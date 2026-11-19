import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { teamQuery } from '@/features/team/queries.ts';
import { useLastSigner } from './last-signer.ts';

/**
 * State for one signed form: the members to pick from, the chosen signer (prefilled with this
 * browser's last signer while they are still in Team), and `remember` for after a successful submit.
 */
export function useSignature() {
  const team = useQuery(teamQuery());
  const { lastSigner, remember } = useLastSigner();
  // undefined until the person picks someone; until then the field shows the prefill.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  const members = team.data?.members ?? [];
  const prefill = lastSigner && members.some((m) => m.id === lastSigner) ? lastSigner : null;
  const signedBy = picked === undefined ? prefill : picked;

  return {
    members,
    isLoading: team.isPending,
    signedBy,
    setSignedBy: setPicked,
    /** Call after the signed request succeeded. */
    remember: () => {
      if (signedBy) remember(signedBy);
    },
  };
}

export type Signature = ReturnType<typeof useSignature>;
