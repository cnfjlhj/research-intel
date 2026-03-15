#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
PID_FILE="$PROJECT_DIR/work/research-intel/runtime/research-intel-web.pid"
LOG_FILE="$PROJECT_DIR/logs/research-intel/web.log"
DOTENV_FILE="$PROJECT_DIR/.env"
RUNTIME_ENV_FILE="$PROJECT_DIR/work/research-intel/profile/runtime.env"
RUNTIME_DIR="$PROJECT_DIR/work/research-intel/runtime"
PUBLIC_URL_FILE="$RUNTIME_DIR/research-intel-public-url.txt"
CLOUDFLARED_CONTAINER_NAME="research-intel-cloudflared"

for ENV_FILE in "$DOTENV_FILE" "$RUNTIME_ENV_FILE"; do
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
done

PUBLIC_MODE="${RESEARCH_INTEL_PUBLIC_MODE:-}"
WEB_PORT="${RESEARCH_INTEL_WEB_PORT:-3086}"
HEALTH_URL="http://127.0.0.1:${WEB_PORT}/research-intel/health"

port_listener_pid() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
    return 0
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :$WEB_PORT )" 2>/dev/null | sed -nE 's/.*pid=([0-9]+).*/\1/p' | head -n 1
    return 0
  fi

  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$WEB_PORT" 2>/dev/null | awk '{print $1}'
    return 0
  fi

  return 1
}

LISTENER_PID="$(port_listener_pid || true)"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "research-intel web running with pid $PID"
    if [[ -n "${LISTENER_PID:-}" ]]; then
      if [[ "$LISTENER_PID" == "$PID" ]]; then
        echo "port owner: $LISTENER_PID (matches managed pid)"
      else
        echo "port owner: $LISTENER_PID (mismatch: health may be served by another process)"
      fi
    fi
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        echo "health: ok ($HEALTH_URL)"
      else
        echo "health: failed ($HEALTH_URL)"
      fi
    else
      echo "health: skipped (curl not found)"
    fi
  else
    echo "research-intel web pid file exists but process is not running"
    if [[ -n "${LISTENER_PID:-}" ]]; then
      echo "port owner: $LISTENER_PID (managed pid file is stale)"
    fi
    if command -v curl >/dev/null 2>&1; then
      if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
        echo "health: ok ($HEALTH_URL) but pid file is stale or another process is serving this port"
      fi
    fi
  fi
else
  echo "research-intel web is not running"
  if [[ -n "${LISTENER_PID:-}" ]]; then
    echo "port owner: $LISTENER_PID (unmanaged listener)"
  fi
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "health: ok ($HEALTH_URL) but no managed pid file was found"
    fi
  fi
fi

if [[ -f "$LOG_FILE" ]]; then
  echo "log: $LOG_FILE"
fi

if [[ "$PUBLIC_MODE" == "cloudflare-quick" ]]; then
  CONTAINER_STATUS="$(docker ps --filter "name=^${CLOUDFLARED_CONTAINER_NAME}$" --format '{{.Status}}' || true)"
  if [[ -n "${CONTAINER_STATUS:-}" ]]; then
    echo "public tunnel running: $CONTAINER_STATUS"
    TUNNEL_URL="$(docker logs "$CLOUDFLARED_CONTAINER_NAME" 2>&1 | grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -n 1 || true)"
    if [[ -n "${TUNNEL_URL:-}" ]]; then
      printf '%s\n' "$TUNNEL_URL" > "$PUBLIC_URL_FILE"
      echo "public https: $TUNNEL_URL"
    elif [[ -f "$PUBLIC_URL_FILE" ]]; then
      echo "public https: $(cat "$PUBLIC_URL_FILE")"
    fi
  else
    echo "public tunnel is not running"
  fi
fi
