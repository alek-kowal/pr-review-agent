#!/usr/bin/env bash
# Deploys a commit to the Mikrus VPS from your machine (P-27): pushes it over SSH into the bare
# repository on the server (the server needs no GitHub access and gets exactly this commit),
# then runs bin/remote-deploy.sh there. Nothing runs from the working tree's uncommitted files.
#
#   deploy/mikrus/deploy.sh [--ref <commit-ish>] [--dry-run]
#
# Settings come from the environment or from deploy/mikrus/deploy.env (gitignored; names in
# deploy.env.example): PRA_DEPLOY_HOST (required), PRA_DEPLOY_PORT (22), PRA_DEPLOY_USER (pra),
# PRA_DEPLOY_KEY (an SSH identity file, optional), PRA_DEPLOY_REPO (/srv/pra/repo.git).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ref=HEAD
dry_run=false

usage() {
  echo "usage: deploy/mikrus/deploy.sh [--ref <commit-ish>] [--dry-run]"
}

while (($# > 0)); do
  case "$1" in
    --ref)
      ref="${2:?--ref needs a commit}"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -f "$here/deploy.env" ]]; then
  # shellcheck source=/dev/null
  source "$here/deploy.env"
fi
host="${PRA_DEPLOY_HOST:-}"
port="${PRA_DEPLOY_PORT:-22}"
user="${PRA_DEPLOY_USER:-pra}"
key="${PRA_DEPLOY_KEY:-}"
repo="${PRA_DEPLOY_REPO:-/srv/pra/repo.git}"
if [[ -z "$host" ]]; then
  echo "PRA_DEPLOY_HOST is not set (environment or $here/deploy.env)" >&2
  exit 2
fi

sha="$(git rev-parse --verify "$ref^{commit}")"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "note: the working tree has uncommitted changes; they are not deployed"
fi

# GIT_SSH_COMMAND is split on spaces: keep the key's path free of them.
ssh_cmd=(ssh -p "$port" -o BatchMode=yes)
if [[ -n "$key" ]]; then ssh_cmd+=(-i "$key" -o IdentitiesOnly=yes); fi
remote="ssh://$user@$host$repo"

echo "Deploying $(git log -1 --format='%h %s' "$sha") to $user@$host:$port"
if [[ "$dry_run" == true ]]; then
  echo "dry run, would run:"
  echo "  GIT_SSH_COMMAND='${ssh_cmd[*]}' git push --force $remote $sha:refs/heads/deploy"
  echo "  ${ssh_cmd[*]} $user@$host 'bash -s -- $sha' < $here/bin/remote-deploy.sh"
  exit 0
fi

GIT_SSH_COMMAND="${ssh_cmd[*]}" git push --force --quiet "$remote" "$sha:refs/heads/deploy"
"${ssh_cmd[@]}" "$user@$host" "bash -s -- $sha" <"$here/bin/remote-deploy.sh"
