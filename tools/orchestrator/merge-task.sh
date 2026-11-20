#!/bin/zsh
# Usage: merge-task.sh <task-id> -> merge main into the worktree, verify there (so the verified tree is exactly
# what lands on main), merge --no-ff into main, push, cleanup. Prints MERGED / FAIL / CONFLICT + short tail.
# On CONFLICT main is untouched; the worktree merge is aborted.
id=$1; repo=$HOME/Projects/pr-review-agent; dir=$HOME/Projects/pr-review-agent.worktrees/$id; log=/tmp/claude-501/verify-$id.log
cd $dir || exit 1
if ! git merge --no-edit -q -m "chore($id): merge main before landing" main >/dev/null 2>&1; then
  echo "CONFLICT $id"; git diff --name-only --diff-filter=U; git merge --abort; exit 2; fi
{ pnpm install --frozen-lockfile && pnpm verify; } > $log 2>&1 || { echo "FAIL verify $id"; tail -25 $log; exit 1; }
cd $repo; git merge --no-ff -q -m "merge: task/$id" task/$id 2>&1 | tail -5 || true
if git diff --name-only --diff-filter=U | grep -q .; then echo "CONFLICT $id"; git diff --name-only --diff-filter=U; exit 2; fi
git remote | grep -q origin && git push -q origin main 2>&1 | tail -3
git worktree remove --force $dir && git branch -q -d task/$id
tab=$(herdr tab list --workspace w2 | jq -r --arg l "$id" '.result.tabs[] | select(.label==$l) | .tab_id'); [[ -n $tab ]] && herdr tab close $tab >/dev/null
echo "MERGED $id -> main $(git rev-parse --short HEAD)"
