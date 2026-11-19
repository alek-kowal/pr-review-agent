#!/usr/bin/env bash
# Health check behind pra-health@<api|worker>.service (P-27). Exit 1 makes systemd start
# pra-restart@<instance>, which restarts that service. A stopped service is left alone: someone
# stopped it on purpose, or systemd is already restarting it after a crash.
set -euo pipefail

target="${1:-}"
# A service that started less than this long ago is still coming up.
grace_seconds=90
heartbeat_file=/run/pra-worker/heartbeat
heartbeat_max_age="${PRA_HEARTBEAT_MAX_AGE_SECONDS:-90}"

active_for() {
  local since
  since="$(systemctl show "$1" --property=ActiveEnterTimestamp --value)"
  [[ -n "$since" ]] || { echo 0; return; }
  echo $(($(date +%s) - $(date -d "$since" +%s)))
}

check_running() {
  local unit="$1"
  if ! systemctl is-active --quiet "$unit"; then
    echo "$unit is not running; nothing to check"
    exit 0
  fi
  if (($(active_for "$unit") < grace_seconds)); then
    echo "$unit started less than ${grace_seconds}s ago; skipping"
    exit 0
  fi
}

case "$target" in
  api)
    check_running pra-api.service
    code=000
    for _ in 1 2 3; do
      code="$(curl --silent --output /dev/null --max-time 10 --write-out '%{http_code}' \
        http://127.0.0.1:3000/health || true)"
      [[ "$code" == 000 ]] || break
      sleep 5
    done
    case "$code" in
      200) exit 0 ;;
      # The api answers; restarting it would not bring the database back.
      503)
        echo "api answers but the database is down (HTTP 503); check: docker ps, pra-mikrus-db-1"
        exit 0
        ;;
      *)
        echo "api did not answer /health (HTTP $code)"
        exit 1
        ;;
    esac
    ;;
  worker)
    check_running pra-worker.service
    if [[ ! -f "$heartbeat_file" ]]; then
      echo "worker heartbeat file $heartbeat_file is missing"
      exit 1
    fi
    age=$(($(date +%s) - $(stat -c %Y "$heartbeat_file")))
    if ((age > heartbeat_max_age)); then
      echo "worker heartbeat is ${age}s old (limit ${heartbeat_max_age}s)"
      exit 1
    fi
    ;;
  *)
    echo "usage: health.sh api|worker" >&2
    exit 2
    ;;
esac
