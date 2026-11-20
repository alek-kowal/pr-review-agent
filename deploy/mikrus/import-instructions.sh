#!/usr/bin/env bash
# Imports instruction files into the deployed app (INSTR), once after the first deploy: copies a
# local copy of the old knowledge folder to the VPS over SSH and runs `pnpm instructions:import`
# there as the deploy user. Without it the database holds no instruction file, and every round
# at level 3 or higher stops before its first stage (Settings → Instructions lists the gaps).
#
#   deploy/mikrus/import-instructions.sh <knowledge-dir> [--dry-run]
#
# Same SSH settings as deploy.sh (environment or deploy/mikrus/deploy.env): PRA_DEPLOY_HOST,
# PRA_DEPLOY_PORT, PRA_DEPLOY_USER, PRA_DEPLOY_KEY. The copy lands in
# /srv/pra/knowledge-import/<timestamp> and stays there; the import never writes to it. Safe to
# run again: files that already have a version are kept. The app reads the database from
# app/.env (the link to /etc/pra/pra.env); this script never prints it.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
base=/srv/pra
dir=""
dry_run=false

usage() {
  echo "usage: deploy/mikrus/import-instructions.sh <knowledge-dir> [--dry-run]"
}

while (($# > 0)); do
  case "$1" in
    --dry-run)
      dry_run=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$dir" ]]; then
        usage >&2
        exit 2
      fi
      dir="$1"
      shift
      ;;
  esac
done

if [[ -z "$dir" ]]; then
  usage >&2
  exit 2
fi
if [[ ! -d "$dir" ]]; then
  echo "not a directory: $dir" >&2
  exit 2
fi

if [[ -f "$here/deploy.env" ]]; then
  # shellcheck source=/dev/null
  source "$here/deploy.env"
fi
host="${PRA_DEPLOY_HOST:-}"
port="${PRA_DEPLOY_PORT:-22}"
user="${PRA_DEPLOY_USER:-pra}"
key="${PRA_DEPLOY_KEY:-}"
if [[ -z "$host" ]]; then
  echo "PRA_DEPLOY_HOST is not set (environment or $here/deploy.env)" >&2
  exit 2
fi

ssh_cmd=(ssh -p "$port" -o BatchMode=yes)
if [[ -n "$key" ]]; then ssh_cmd+=(-i "$key" -o IdentitiesOnly=yes); fi

target="$base/knowledge-import/$(date +%Y%m%d-%H%M%S)"
# Runs on the server: unpack the copy from stdin, then import it from the app's checkout.
remote="set -euo pipefail
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
mkdir -p $(printf '%q' "$target")
tar -C $(printf '%q' "$target") -xf -
cd $(printf '%q' "$base/app")
pnpm --silent instructions:import --from $(printf '%q' "$target")"

echo "Importing instructions from $dir to $user@$host:$port ($target)"
if [[ "$dry_run" == true ]]; then
  echo "dry run, would run:"
  echo "  tar -C $dir --exclude=.git -cf - . | ${ssh_cmd[*]} $user@$host bash -c '<remote>'"
  echo "remote:"
  printf '%s\n' "$remote" | sed 's/^/  /'
  exit 0
fi

# COPYFILE_DISABLE keeps macOS tar from adding ._ metadata files.
COPYFILE_DISABLE=1 tar -C "$dir" --exclude=.git -cf - . |
  "${ssh_cmd[@]}" "$user@$host" "bash -c $(printf '%q' "$remote")"
