#!/bin/zsh
# Usage: continue-task.sh <package-id> [prompt-file] -> fresh session in the same pane, continuing from the handoff
id=$1; pf=${2:-${0:h}/prompts/package-continue.txt}; name="t-${(L)id//[^a-zA-Z0-9]/-}"; name=${name[1,32]}
p=$(herdr agent get $name | jq -r '.result.agent.pane_id')
herdr agent prompt $name "/exit" >/dev/null 2>&1; for i in {1..10}; do sleep 2; herdr agent get $name >/dev/null 2>&1 || break; done
herdr agent start $name --kind claude --pane $p --timeout 90000 -- --disallowedTools AskUserQuestion -n $name >/dev/null 2>&1 || true
herdr agent prompt $name "$(sed "s/{{ID}}/$id/g" $pf)" >/dev/null
# under heavy load the Enter can be lost and the prompt stays in the input box: retry Enter
for i in {1..3}; do sleep 10; [[ $(herdr agent get $name | jq -r '.result.agent.agent_status') == idle ]] || break; herdr agent send-keys $name enter >/dev/null; done
echo "continued $name pane=$p status=$(herdr agent get $name | jq -r '.result.agent.agent_status')"
