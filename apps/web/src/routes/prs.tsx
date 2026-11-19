import { createFileRoute } from '@tanstack/react-router';
import { copy } from '../copy/index.ts';

export const Route = createFileRoute('/prs')({
  component: PullRequestsPage,
});

function PullRequestsPage() {
  return (
    <main>
      <h1>{copy.prs.title}</h1>
      <p>{copy.prs.placeholder}</p>
    </main>
  );
}
