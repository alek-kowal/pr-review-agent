// The command palette's Actions group (S-17-T5): a static registry. A page or feature that adds
// an action adds one entry here and its label in `copy.palette.actions[id]`.
import { openStartReview } from '@/features/rounds/open-start-review.ts';
import { openStatusChip } from '@/features/shell/open-status-chip.ts';
import { openShortcuts } from '@/features/shortcuts/open-shortcuts.ts';
import { toggleTheme } from '@/features/theme/theme.ts';

export type PaletteContext = {
  /** The PR on screen, on a PR page; null elsewhere. */
  pr: { repo: string; number: string } | null;
};

export type PaletteAction = {
  /** The key of its label in `copy.palette.actions`. */
  id: string;
  /** Extra words the search matches. */
  keywords?: string;
  /** Kbd hint shown at the end of the item. */
  shortcut?: string;
  /** Shown only when this returns true; always shown when left out. */
  available?: (context: PaletteContext) => boolean;
  /** Runs after the palette has closed, so a dialog or popover it opens keeps the focus. */
  run: (context: PaletteContext) => void;
};

export const PALETTE_ACTIONS: PaletteAction[] = [
  { id: 'shortcuts', keywords: 'keyboard keys help', shortcut: '?', run: () => openShortcuts() },
  { id: 'theme', keywords: 'dark light mode appearance colour color', run: () => toggleTheme() },
  { id: 'pause', keywords: 'resume budget status factory agents', run: () => openStatusChip() },
  {
    id: 'startReview',
    keywords: 'round run level',
    available: (context) => context.pr !== null,
    run: () => openStartReview(),
  },
];
