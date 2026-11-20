#!/bin/zsh
# Usage: watch-many.sh <ctx-limit> <name>... ; exits when ANY agent stops, blocks, vanishes or hits the limit
limit=$1; shift; typeset -A seen
while true; do
  for n in "$@"; do
    st=$(herdr agent get "$n" 2>/dev/null | jq -r '.result.agent.agent_status // "gone"')
    p=$(herdr agent get "$n" 2>/dev/null | jq -r '.result.agent.pane_id // empty')
    c=$([[ -n $p ]] && herdr pane read $p --source visible 2>/dev/null | grep -o 'ctx:[0-9.]*k [0-9]*%' | tail -1); pct=${${c##* }%\%}
    [[ $st == working ]] && seen[$n]=1
    if [[ -n $pct && $pct -ge $limit ]]; then echo "CTX_LIMIT $n $st $c"; exit 0; fi
    if [[ $st == gone || $st == blocked ]]; then echo "${(U)st} $n $c"; exit 0; fi
    if [[ $st != working && -n ${seen[$n]} ]]; then echo "STOPPED $n $st $c"; exit 0; fi
    [[ $st != working ]] && seen[$n]=1
  done; sleep ${WATCH_EVERY:-15}
done
