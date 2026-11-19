import { createFileRoute } from '@tanstack/react-router';
import { InstructionEditor } from '@/features/instructions/InstructionEditor.tsx';
import { TryOnPrDialog } from '@/features/trials/TryOnPrDialog.tsx';

export const Route = createFileRoute('/settings/instructions/$id')({
  component: InstructionRoute,
});

function InstructionRoute() {
  const { id } = Route.useParams();
  return (
    <InstructionEditor
      id={Number(id)}
      tryOnPr={(detail, draft) => <TryOnPrDialog detail={detail} draft={draft} />}
    />
  );
}
