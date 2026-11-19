#!/usr/bin/env bash
# Disk cleanup behind pra-cleanup.service (P-27): files of ended runs, stray files and package
# caches unused for PRA_CACHE_MAX_AGE_DAYS (`pnpm data:cleanup`), then stopped sandbox containers
# and dangling images. Images in use (node:24-slim for the sandbox, postgres:17) stay.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

pnpm data:cleanup --cache-max-age-days "${PRA_CACHE_MAX_AGE_DAYS:-7}"
docker container prune --force --filter label=pra.sandbox
docker image prune --force
df -h / | tail -n 1
