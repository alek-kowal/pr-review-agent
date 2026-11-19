import { createFileRoute } from '@tanstack/react-router';
import { InstructionEditor } from '@/features/instructions/InstructionEditor.tsx';

export const Route = createFileRoute('/settings/instructions/$id')({
  component: InstructionRoute,
});

function InstructionRoute() {
  const { id } = Route.useParams();
  return <InstructionEditor id={Number(id)} />;
}
