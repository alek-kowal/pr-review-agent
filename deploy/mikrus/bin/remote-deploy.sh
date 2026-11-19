#!/usr/bin/env bash
# Server side of deploy/mikrus/deploy.sh (P-27). deploy.sh pushes the commit to the bare
# repository and pipes this file to `bash -s -- <commit>` over SSH as the `pra` user, so the
# version of this script that runs is always the one being deployed.
#
# Steps: check out the commit, install, build api and worker (types were checked before the
# commit, so no type check on a 1-vCPU host), build the SPA into its own release folder, apply
# migrations (`pnpm db:migrate`, the only place they run), switch nginx to the new SPA, restart
# api and worker, and wait until both are healthy.
set -euo pipefail

sha="${1:?usage: remote-deploy.sh <commit>}"
base="${PRA_BASE_DIR:-/srv/pra}"
app="$base/app"
releases="$base/web/releases"
min_free_kib=$((2 * 1024 * 1024))
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export CI=true
# nginx (www-data) reads the SPA builds.
umask 022

step() { printf '\n==> %s\n' "$*"; }

exec 9>"$base/.deploy.lock"
flock --nonblock 9 || {
  echo "another deploy is running" >&2
  exit 1
}

free_kib="$(df --output=avail -k "$base" | tail -n 1 | tr -d ' ')"
if ((free_kib < min_free_kib)); then
  echo "less than 2 GiB free on $base ($((free_kib / 1024)) MiB); run pra-cleanup first" >&2
  exit 1
fi

step "Checking out $sha"
cd "$app"
git fetch --quiet origin
git checkout --quiet --force --detach "$sha"
# Untracked files go; ignored ones (.env link, node_modules, dist) stay.
git clean -fdq

step "Installing dependencies"
pnpm install --frozen-lockfile

step "Building api and worker"
for name in api worker; do
  pnpm --filter "@pra/$name" run clean
  pnpm --filter "@pra/$name" exec tsc -p tsconfig.build.json --noCheck
done

step "Building the web app"
release="$releases/$sha"
mkdir -p "$releases"
pnpm --filter @pra/web exec vite build --outDir "$release" --emptyOutDir

step "Applying migrations"
pnpm db:migrate

step "Switching the web app to $sha"
ln -sfn "$release" "$base/web/current.next"
mv -Tf "$base/web/current.next" "$base/web/current"
# Keep the three newest releases: open tabs still find their old assets for a while.
find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +4 |
  cut -d' ' -f2- | xargs -r rm -rf

step "Restarting api and worker"
sudo -n /usr/bin/systemctl restart pra-api.service pra-worker.service

step "Waiting for health"
api_ok=false
for _ in $(seq 1 30); do
  if curl --silent --fail --max-time 5 http://127.0.0.1:3000/health >/dev/null; then
    api_ok=true
    break
  fi
  sleep 2
done
worker_ok=false
for _ in $(seq 1 30); do
  if systemctl is-active --quiet pra-worker.service && [[ -f /run/pra-worker/heartbeat ]]; then
    worker_ok=true
    break
  fi
  sleep 2
done
echo "api healthy: $api_ok; worker running: $worker_ok"
if [[ "$api_ok" != true || "$worker_ok" != true ]]; then
  echo "see: journalctl -u pra-api -u pra-worker -n 100" >&2
  exit 1
fi
echo "Deployed $sha"
