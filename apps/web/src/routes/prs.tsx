import { createFileRoute } from '@tanstack/react-router';
import { Board } from '@/features/board/Board.tsx';

export const Route = createFileRoute('/prs')({
  component: Board,
});
