#!/bin/zsh
# Prints packages whose deps are merged into main and which are not merged/running
S=${0:a:h}; repo=$HOME/Projects/pr-review-agent; merged=$(git -C $repo log main --format=%s | grep -o 'merge: task/P-[0-9]*' | sed 's#merge: task/##')
while IFS=$'\t' read id deps plan; do
  echo $merged | grep -qx $id && continue; [[ -d $HOME/Projects/pr-review-agent.worktrees/$id ]] && continue
  ok=1; for d in ${(s:,:)deps}; do [[ $d == F-01 ]] && continue; echo $merged | grep -qx $d || ok=0; done
  (( ok )) && echo $id
done < $S/packages.tsv
