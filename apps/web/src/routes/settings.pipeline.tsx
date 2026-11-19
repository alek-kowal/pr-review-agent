import { createFileRoute } from '@tanstack/react-router';
import { PipelinePage } from '@/features/pipeline/PipelinePage.tsx';

export const Route = createFileRoute('/settings/pipeline')({
  component: PipelinePage,
});
