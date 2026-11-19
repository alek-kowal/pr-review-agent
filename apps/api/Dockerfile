# Build: docker build -f apps/api/Dockerfile -t pra-api .   (context = repository root)
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
# App first (type-checked against the workspace sources), then the packages to JS for node_modules.
RUN pnpm --filter @pra/api build && node deploy/compile-workspace.mjs
RUN pnpm deploy --filter @pra/api --prod /out

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
# Owned by root: the app user can read its code but not change it.
COPY --from=build /out ./
USER node
EXPOSE 3000
# instrument.js first: OpenTelemetry patches http, Fastify and pg before the app loads them.
CMD ["node", "--import", "./dist/instrument.js", "dist/main.js"]
