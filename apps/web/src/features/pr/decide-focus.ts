import { createContext, useContext } from 'react';

/** The Decide main action asks the Findings tab to open and focus the first finding to decide. */
export type DecideFocus = {
  /** Grows with each request; 0 when there is none (a tab change drops it). */
  request: number;
  /** Shows the Findings tab and focuses the first finding that needs a decision. */
  focusFirstUndecided: () => void;
};

export const DecideFocusContext = createContext<DecideFocus>({
  request: 0,
  focusFirstUndecided: () => {},
});

export const useDecideFocus = (): DecideFocus => useContext(DecideFocusContext);
