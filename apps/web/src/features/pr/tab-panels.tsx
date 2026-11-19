import { copy } from '@/copy/index.ts';
import { EmptyTab } from './EmptyTab.tsx';

// Tabs whose content arrives in later slices: Patch (S-13).
export function PatchTab() {
  return <EmptyTab text={copy.pr.empty.patch} />;
}
