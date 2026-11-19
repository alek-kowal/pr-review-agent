import { useCallback, useState } from 'react';

/** Where this browser keeps the last signer's member id (FR-087). */
export const LAST_SIGNER_KEY = 'pra.lastSigner';

// Storage can be missing or throw (private mode, blocked site data); a signature then simply
// starts empty and is not remembered.
export function readLastSigner(): string | null {
  try {
    return window.localStorage.getItem(LAST_SIGNER_KEY);
  } catch {
    return null;
  }
}

export function writeLastSigner(memberId: string): void {
  try {
    window.localStorage.setItem(LAST_SIGNER_KEY, memberId);
  } catch {
    // Not remembered; the next form starts empty.
  }
}

/** The last signer in this browser, and `remember` to call after a signed submit succeeds. */
export function useLastSigner() {
  const [lastSigner, setLastSigner] = useState<string | null>(readLastSigner);
  const remember = useCallback((memberId: string) => {
    writeLastSigner(memberId);
    setLastSigner(memberId);
  }, []);
  return { lastSigner, remember };
}
