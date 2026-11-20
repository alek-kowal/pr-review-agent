#!/bin/zsh
# Usage: handoff.sh <agent-name> <package-id> [extra note] -> interrupt and ask for a handoff file
name=$1; id=$2; note=$3
herdr agent send-keys $name esc >/dev/null; sleep 3; herdr agent wait $name --timeout 30000 >/dev/null 2>&1
herdr agent prompt $name "Stop now: your context is full (the orchestrator measures it). Do not continue the current task. 1) Commit the working tree: finished tasks as usual, a half-done one as 'wip(<scope>): <task> (partial)'. 2) Write context/changes/$id-handoff.md, at most 15 lines: tasks done, what is left (the partial task first), state of the code, anything the next session must know. ${note} 3) Commit it and stop. Reply in 2 lines." >/dev/null && echo "handoff requested $name"
