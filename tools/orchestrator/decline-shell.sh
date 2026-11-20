#!/bin/zsh
# Usage: decline-shell.sh <agent> -> declines a pending risky shell prompt and redirects the agent to Write/Edit
n=$1; herdr agent send-keys $n esc >/dev/null; sleep 3; herdr agent wait $n --timeout 30000 >/dev/null 2>&1
herdr agent prompt $n "The orchestrator declined your last shell command: the permission check could not rule out a dangerous rm (shell heredocs that write files trigger it). Write and change files only with the Write/Edit tools, delete tracked files with a plain 'git rm <path>', and keep shell commands to running tools. Redo that step this way, then continue." >/dev/null && echo "redirected $n"
