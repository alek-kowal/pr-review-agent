import { createFileRoute } from '@tanstack/react-router';
import { ModelsPage } from '@/features/models/ModelsPage.tsx';

export const Route = createFileRoute('/settings/models')({
  component: ModelsPage,
});
