#!/bin/zsh
# Waits until the orchestrator pane (w2:p1) finishes its turn, then sends /compact with instructions.
sleep 20; herdr agent wait w2:p1 --until idle --until done --timeout 600000 >/dev/null 2>&1; sleep 5
herdr agent prompt w2:p1 "/compact Orchestrator, PR Review Agent. Keep Alek's rules and the resume point docs/ORCHESTRATOR-STATE.md plus scratchpad scripts. Running: supervise.sh over wave 6 + t-p-11r. Next ready: P-23. Drop raw tool output."
echo "compact sent"
