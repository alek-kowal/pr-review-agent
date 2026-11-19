# Build: docker build -f apps/worker/Dockerfile -t pra-worker .   (context = repository root)
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
# App first (type-checked against the workspace sources), then the packages to JS for node_modules.
RUN pnpm --filter @pra/worker build && node deploy/compile-workspace.mjs
RUN pnpm deploy --filter @pra/worker --prod /out

FROM node:24-slim
# git for GitMirror (bare mirrors and a worktree per run).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# Owned by root: the app user can read its code but not change it.
COPY --from=build /out ./
# The only writable app path: the git mirrors and worktrees (a volume in deploy/compose.yaml).
RUN mkdir -p /app/.data/git && chown -R node:node /app/.data
USER node
# instrument.js first: OpenTelemetry patches http, Fastify and pg before the app loads them.
CMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]
