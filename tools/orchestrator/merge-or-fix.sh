#!/bin/zsh
# Usage: merge-or-fix.sh <package-id>
# Exits the agent, merges when load is calm. On CONFLICT: aborts the merge on main and starts a
# fresh merge-fix agent in the package's pane. Prints MERGED / FIXING / FAIL.
D=${0:h}; id=$1; name="t-${(L)id//[^a-zA-Z0-9]/-}"; name=${name[1,32]}; M=~/Projects/pr-review-agent
herdr agent prompt $name /exit >/dev/null 2>&1; sleep 4
herdr agent read $name --source visible 2>/dev/null | grep -q 'Background work is running' && herdr agent send-keys $name enter >/dev/null
out=$($D/merge-when-calm.sh $id 2>&1)
if print -r -- "$out" | grep -q '^MERGED'; then print -r -- "$out" | grep '^MERGED'; exit 0; fi
if [[ -n $(git -C $M diff --name-only --diff-filter=U) ]] || print -r -- "$out" | grep -q CONFLICT; then
  files=$(print -r -- "$out" | grep -v -E '^(CONFLICT|FAIL|MERGED|waiting|load)' | grep -c '/')
  git -C $M merge --abort 2>/dev/null
  tab=$(herdr tab list --workspace w2 | jq -r ".result.tabs[]|select(.label==\"$id\")|.tab_id")
  p=$(herdr pane list --workspace w2 | jq -r ".result.panes[]|select(.tab_id==\"$tab\")|.pane_id" | head -1)
  herdr agent start $name --kind claude --pane $p --timeout 90000 -- --disallowedTools AskUserQuestion -n $name >/dev/null 2>&1
  herdr agent prompt $name "$(sed "s/{{ID}}/$id/g" $D/prompts/merge-fix-generic.txt)" >/dev/null
  for i in {1..3}; do sleep 10; [[ $(herdr agent get $name | jq -r '.result.agent.agent_status') == idle ]] || break; herdr agent send-keys $name enter >/dev/null; done
  echo "FIXING $id conflicts=$files agent=$name pane=$p"; exit 0
fi
echo "FAIL $id"; print -r -- "$out" | tail -5
