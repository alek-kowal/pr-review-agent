#!/bin/zsh
# Usage: ci-wait.sh [sha] -> waits for CI on main's sha, prints conclusion and failing step log tail
export GH_TOKEN=$(gh auth token --user alek-kowal); R=alek-kowal/pr-review-agent
sha=$(git -C ~/Projects/pr-review-agent rev-parse ${1:-HEAD})
for i in {1..60}; do id=$(gh run list -R $R -c $sha -L 1 --json databaseId -q '.[0].databaseId'); [[ -n $id ]] && break; sleep 10; done
[[ -z $id ]] && { echo "CI ${sha[1,7]} no-run"; exit 0; }
gh run watch $id -R $R --exit-status >/dev/null 2>&1; c=$(gh run view $id -R $R --json conclusion -q .conclusion)
echo "CI ${sha[1,7]} $c"; [[ $c != success ]] && gh run view $id -R $R --log-failed 2>/dev/null | tail -30
true
