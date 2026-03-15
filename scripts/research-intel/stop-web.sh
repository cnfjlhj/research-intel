#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_DIR/work/research-intel/runtime/research-intel-web.pid"
RUNTIME_ENV_FILE="$PROJECT_DIR/work/research-intel/profile/runtime.env"
RUNTIME_DIR="$PROJECT_DIR/work/research-intel/runtime"
PUBLIC_URL_FILE="$RUNTIME_DIR/research-intel-public-url.txt"
CLOUDFLARED_CONTAINER_NAME="research-intel-cloudflared"

if [[ -f "$RUNTIME_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$RUNTIME_ENV_FILE"
  set +a
fi

PUBLIC_MODE="${RESEARCH_INTEL_PUBLIC_MODE:-}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "research-intel web is not running (no pid file)"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${PID:-}" ]]; then
  rm -f "$PID_FILE"
  echo "pid file was empty and has been removed"
  exit 0
fi

if kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped research-intel web pid $PID"
else
  echo "process $PID was not running"
fi

rm -f "$PID_FILE"

if [[ "$PUBLIC_MODE" == "cloudflare-quick" ]]; then
  docker rm -f "$CLOUDFLARED_CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$PUBLIC_URL_FILE"
  echo "stopped public tunnel $CLOUDFLARED_CONTAINER_NAME"
fi
