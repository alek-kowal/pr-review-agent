# Build: docker build -f apps/web/Dockerfile -t pra-web .   (context = repository root)
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
RUN pnpm install --offline --frozen-lockfile
RUN pnpm --filter @pra/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
# Caddy keeps its state in /data and /config; port 8080 needs no root.
RUN chown -R 1000:1000 /data /config
USER 1000:1000
EXPOSE 8080
