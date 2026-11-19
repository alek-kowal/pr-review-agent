import { createFileRoute } from '@tanstack/react-router';
import { AuditPage } from '@/features/audit/AuditPage.tsx';
import { validateAuditSearch } from '@/features/audit/search.ts';

export const Route = createFileRoute('/settings/audit')({
  validateSearch: validateAuditSearch,
  component: AuditPage,
});
