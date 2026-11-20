#!/bin/zsh
# Usage: supervise.sh <agent-name...>
# Handles context limits by itself (handoff at LIMIT%, then a fresh continuation session).
# Exits only when an agent finishes (FINISHED), blocks (BLOCKED) or disappears (GONE). Log: $0:h/supervise.log
D=${0:h}; LIMIT=${LIMIT:-26}; typeset -A seen; mkdir -p $D/state
for n in $@; do seen[$n]=0; done
# handed-off flags persist in state/<name>.handed, so a restarted supervisor keeps them
is_handed() { [[ -f $D/state/$1.handed ]]; }
log() { echo "$(date +%H:%M:%S) $*" >> $D/supervise.log; }
while true; do
  free=$(df -g /System/Volumes/Data | awk 'NR==2{print $4}'); (( free < ${MIN_FREE_GB:-4} )) && { echo "DISK_LOW ${free}GB"; exit 0; }
  for n in $@; do
    st=$(herdr agent get $n 2>/dev/null | jq -r '.result.agent.agent_status // "gone"')
    pct=$(herdr agent read $n --source visible 2>/dev/null | grep -o 'ctx:[0-9.]*k [0-9]*%' | tail -1 | grep -o '[0-9]*%' | tr -d %)
    if [[ $n == t-p-* ]]; then id="P-${n#t-p-}"; else id=${(U)n#t-}; fi
    [[ $st == gone ]] && { echo "GONE $n"; exit 0; }
    if [[ $st == blocked ]]; then
      if herdr agent read $n --source visible 2>/dev/null | grep -q 'Dangerous rm operation not ruled out'; then
        $D/decline-shell.sh $n >/dev/null; log "declined risky shell for $n"; continue; fi
      echo "BLOCKED $n ${pct}%"; exit 0; fi
    [[ $st == working ]] && seen[$n]=1
    # a handoff turn can be shorter than WATCH_EVERY: after 45 s, a handed agent that is not working is done
    if is_handed $n && [[ $st != working ]] && (( $(date +%s) - $(stat -f %m $D/state/$n.handed) > 45 )); then seen[$n]=1; fi
    if ! is_handed $n && [[ $st == working && -n $pct && $pct -ge $LIMIT ]]; then
      $D/handoff.sh $n $id >/dev/null; touch $D/state/$n.handed; seen[$n]=0; log "handoff $n at ${pct}%"; continue; fi
    if [[ $st != working && ${seen[$n]} == 1 ]]; then
      tailtxt=$(herdr agent read $n --source recent-unwrapped --lines 25 2>/dev/null)
      # an agent waiting for its own background shell (e.g. e2e) is not finished
      print -r -- "$tailtxt" | grep -qE '(shells?|monitors?|tasks?|agents?) still running' && continue
      last=$(print -r -- "$tailtxt" | grep '⏺' | tail -1)
      # usage limit: the agent resumes by itself at reset (and an API error after that gets a nudge below)
      [[ $last == *"Usage limit reached"* ]] && continue
      if [[ $last == *"API Error"* ]]; then
        sleep 30; herdr agent prompt $n "Continue the task from where you stopped (the API error was temporary)." >/dev/null; seen[$n]=0; log "nudged $n after API error"; continue; fi
      if is_handed $n; then
        $D/continue-task.sh $id >/dev/null; rm -f $D/state/$n.handed; seen[$n]=0; log "continued $n"
      else echo "FINISHED $n ${pct}%"; exit 0; fi
    fi
  done; sleep ${WATCH_EVERY:-15}
done
