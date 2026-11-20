#!/bin/zsh
# Usage: merge-when-calm.sh <id> [max-load=16] -> waits for a low 1-min load, then merge-task.sh; retries once on FAIL
id=$1; max=${2:-16}; D=${0:h}
for try in 1 2; do
  for i in {1..80}; do l=$(sysctl -n vm.loadavg | awk '{print int($2)}'); (( l < max )) && break; sleep 30; done
  out=$($D/merge-task.sh $id 2>&1); echo "$out" | grep -qE '^MERGED|^CONFLICT' && { echo "$out" | tail -6; exit 0; }
done; echo "$out" | grep -E '×|FAIL|error' | head -10; echo "FAIL $id"
