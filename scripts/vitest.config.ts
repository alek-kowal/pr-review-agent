import { defineProject } from 'vitest/config';

// Root scripts such as check-repo-agnostic.ts; their tests need no database.
export default defineProject({
  test: {
    name: 'scripts',
  },
});
