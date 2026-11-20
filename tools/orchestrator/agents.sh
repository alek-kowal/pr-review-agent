#!/bin/zsh
# One line per live agent in workspace w2: name status ctx
herdr agent list | jq -r '.result.agents[] | select(.workspace_id=="w2") | "\(.name // "-") \(.pane_id) \(.agent_status)"' | while read n p s; do
  c=$(herdr pane read $p --source visible 2>/dev/null | grep -o 'ctx:[0-9.]*k [0-9]*%' | tail -1); echo "$n $p $s ${c:-?}"; done
