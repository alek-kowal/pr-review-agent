#!/bin/zsh
# Usage: watch-agent.sh <agent-name> [ctx-threshold-percent=27] [interval-seconds=45]
# Exits (printing a reason) when the agent stops working (idle/done/blocked/gone)
# or when its Claude Code status line shows context >= threshold.
name=$1; limit=${2:-27}; every=${3:-45}
seen_working=0
while true; do
  st=$(herdr agent get "$name" 2>/dev/null | jq -r '.result.agent.agent_status // "gone"')
  ctx=$(herdr agent read "$name" --source visible 2>/dev/null | grep -o 'ctx:[0-9.]*k [0-9]*%' | tail -1)
  pct=${${ctx##* }%\%}
  [[ "$st" == working ]] && seen_working=1
  if [[ -n "$pct" && "$pct" -ge "$limit" ]]; then echo "CTX_LIMIT $name status=$st $ctx"; exit 0; fi
  if [[ "$st" == gone ]]; then echo "GONE $name"; exit 0; fi
  if [[ "$st" == blocked ]]; then echo "BLOCKED $name $ctx"; exit 0; fi
  if [[ "$st" != working && $seen_working == 1 ]]; then echo "STOPPED $name status=$st $ctx"; exit 0; fi
  if [[ "$st" != working ]]; then seen_working=1; fi  # first sample idle: give it one more round
  sleep $every
done
