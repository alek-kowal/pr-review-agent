import { copy } from '@/copy/index.ts';
import { EmptyTab } from './EmptyTab.tsx';

// Tabs whose content arrives in later slices: Questions (S-08), Patch (S-13).
export function QuestionsTab() {
  return <EmptyTab text={copy.pr.empty.questions} />;
}

export function PatchTab() {
  return <EmptyTab text={copy.pr.empty.patch} />;
}
