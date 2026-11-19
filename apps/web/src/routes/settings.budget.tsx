import { createFileRoute } from '@tanstack/react-router';
import { BudgetPage } from '@/features/budget/BudgetPage.tsx';

export const Route = createFileRoute('/settings/budget')({
  component: BudgetPage,
});
