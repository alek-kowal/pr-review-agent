#!/bin/zsh
# Usage: spawn-task.sh <task-id> <prompt-file> [main]  -> worktree + tab + fresh agent + prompt (one line out)
set -e; id=$1; pf=$2; repo=$HOME/Projects/pr-review-agent; name="t-${(L)id//[^a-zA-Z0-9]/-}"; name=${name[1,32]}
if [[ $3 == main ]]; then dir=$repo; else dir=$HOME/Projects/pr-review-agent.worktrees/$id
  [[ -d $dir ]] || git -C $repo worktree add -q -b task/$id $dir main; fi
t=$(herdr tab create --workspace w2 --cwd "$dir" --label "$id" --no-focus); p=$(echo $t | jq -r '.result.root_pane.pane_id')
r=$(herdr agent start $name --kind claude --pane $p --timeout 90000 -- --disallowedTools AskUserQuestion -n $name 2>&1 || true)
if echo $r | grep -q agent_not_ready; then herdr agent send-keys $name down enter >/dev/null; herdr agent wait $name --until idle --timeout 60000 >/dev/null; fi
herdr agent prompt $name "$(sed "s/{{ID}}/$id/g" $pf)" >/dev/null
echo "spawned $name pane=$p dir=$dir status=$(herdr agent get $name | jq -r '.result.agent.agent_status')"
