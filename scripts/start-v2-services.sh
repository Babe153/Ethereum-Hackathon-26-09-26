#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
source "$ROOT_DIR/.env"
set +a

# Keep the first escrow and its service/data running for historical tasks.
export ESCROW_ADDRESS="0x989c71426552fF963e2A6647c05565003A922ff5"
export SERVICE_PORT="8788"
export SERVICE_BASE_URL="http://localhost:8788"
export DEMO_DATA_DIR="$ROOT_DIR/services/data/v2"

cd "$ROOT_DIR/services"
mkdir -p "$DEMO_DATA_DIR/logs"

for role in server agent verifier; do
  pid_file="$DEMO_DATA_DIR/$role.pid"
  if [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
    echo "$role already running as $(cat "$pid_file")"
    continue
  fi
  entry="$role"
  if [[ "$role" == "agent" ]]; then entry="agent-worker"; fi
  nohup ./node_modules/.bin/tsx "src/$entry.ts" >"$DEMO_DATA_DIR/logs/$role.log" 2>&1 </dev/null &
  echo "$!" >"$pid_file"
  echo "Started v2 $role as $!"
done

if [[ "${1:-}" == "--foreground" ]]; then
  wait
fi
