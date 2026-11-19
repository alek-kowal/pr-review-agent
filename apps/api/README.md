# @pra/api

Fastify HTTP api. The layout follows the Fastify-CLI generator (`src/plugins`, `src/routes`, loaded
by `@fastify/autoload`); the entry is `src/main.ts`, which builds the server with
`buildServer()` from `src/server.ts`.

## Scripts

- `pnpm dev`: run `src/main.ts` with Node's watch mode and the root `.env`, on
  http://localhost:3000 (`PORT`, `HOST` override it).
- `pnpm build && pnpm start`: compile to `dist/` and run `dist/main.js`.
- `pnpm test`: Vitest.

Logs use the shared pino options from `@pra/integrations/logging`: pretty in development, JSON
lines with `service: "api"` when `NODE_ENV=production`.
