#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/research-intel"
RUNTIME_DIR="$PROJECT_DIR/work/research-intel/runtime"
PID_FILE="$RUNTIME_DIR/research-intel-web.pid"
LOG_FILE="$LOG_DIR/web.log"
DOTENV_FILE="$PROJECT_DIR/.env"
RUNTIME_ENV_FILE="$PROJECT_DIR/work/research-intel/profile/runtime.env"
PUBLIC_URL_FILE="$RUNTIME_DIR/research-intel-public-url.txt"
CLOUDFLARED_CONTAINER_NAME="research-intel-cloudflared"

resolve_node() {
  if [[ -n "${NODE_BIN:-}" ]] && [[ -x "${NODE_BIN}" ]]; then
    printf '%s\n' "$NODE_BIN"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "${HOME}/.nvm/nvm.sh" >/dev/null 2>&1
    if command -v node >/dev/null 2>&1; then
      command -v node
      return 0
    fi
  fi

  local fallback=""
  fallback="$(find "${HOME}/.nvm/versions/node" -maxdepth 3 -path '*/bin/node' -type f 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "${fallback:-}" ]]; then
    printf '%s\n' "$fallback"
    return 0
  fi

  echo "research-intel web start failed: node executable not found" >&2
  return 1
}

NODE_BIN="$(resolve_node)"

for ENV_FILE in "$DOTENV_FILE" "$RUNTIME_ENV_FILE"; do
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
done

WEB_PORT="${RESEARCH_INTEL_WEB_PORT:-3086}"
PUBLIC_MODE="${RESEARCH_INTEL_PUBLIC_MODE:-}"
HEALTH_URL="http://127.0.0.1:${WEB_PORT}/research-intel/health"

mkdir -p "$LOG_DIR" "$RUNTIME_DIR"

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

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${EXISTING_PID:-}" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    if command -v curl >/dev/null 2>&1 && curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      EXISTING_LISTENER_PID="$(port_listener_pid || true)"
      if [[ -n "${EXISTING_LISTENER_PID:-}" ]] && [[ "$EXISTING_LISTENER_PID" != "$EXISTING_PID" ]]; then
        echo "research-intel web pid $EXISTING_PID is alive, but port $WEB_PORT is actually served by pid $EXISTING_LISTENER_PID" >&2
        exit 1
      fi
      echo "research-intel web already running with pid $EXISTING_PID"
      echo "health: ok ($HEALTH_URL)"
      exit 0
    fi

    echo "research-intel web pid $EXISTING_PID is alive but health check failed; restarting"
    kill "$EXISTING_PID" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
  fi
fi

EXISTING_PORT_PID="$(port_listener_pid || true)"
if [[ -n "${EXISTING_PORT_PID:-}" ]]; then
  MANAGED_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "${MANAGED_PID:-}" ]] || [[ "$EXISTING_PORT_PID" != "$MANAGED_PID" ]]; then
    echo "research-intel web start aborted: port $WEB_PORT is already served by pid $EXISTING_PORT_PID, not the managed pid file" >&2
    echo "health url: $HEALTH_URL" >&2
    exit 1
  fi
fi

cd "$PROJECT_DIR"
nohup "$NODE_BIN" "$SCRIPT_DIR/web-server.js" >>"$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "research-intel web started with pid $(cat "$PID_FILE")"
echo "log: $LOG_FILE"

if command -v curl >/dev/null 2>&1; then
  HEALTH_OK=""
  for _ in $(seq 1 20); do
    STARTED_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${STARTED_PID:-}" ]] && ! kill -0 "$STARTED_PID" 2>/dev/null; then
      break
    fi
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      HEALTH_OK="1"
      break
    fi
    sleep 1
  done

  if [[ -z "${HEALTH_OK:-}" ]]; then
    FAILED_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${FAILED_PID:-}" ]]; then
      kill "$FAILED_PID" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
    echo "research-intel web failed health check: $HEALTH_URL" >&2
    if [[ -f "$LOG_FILE" ]]; then
      tail -n 40 "$LOG_FILE" >&2 || true
    fi
    exit 1
  fi
  LISTENER_PID="$(port_listener_pid || true)"
  STARTED_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${LISTENER_PID:-}" ]] && [[ -n "${STARTED_PID:-}" ]] && [[ "$LISTENER_PID" != "$STARTED_PID" ]]; then
    kill "$STARTED_PID" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
    echo "research-intel web failed ownership check: health is served by pid $LISTENER_PID, but this launch created pid $STARTED_PID" >&2
    echo "health url: $HEALTH_URL" >&2
    exit 1
  fi
  echo "health: ok ($HEALTH_URL)"
else
  echo "health: skipped (curl not found)"
fi

if [[ "$PUBLIC_MODE" == "cloudflare-quick" ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    echo "research-intel public tunnel start failed: docker not found" >&2
    exit 1
  fi

  RUNNING_CONTAINER_ID="$(docker ps -q --filter "name=^${CLOUDFLARED_CONTAINER_NAME}$")"
  if [[ -z "$RUNNING_CONTAINER_ID" ]]; then
    docker rm -f "$CLOUDFLARED_CONTAINER_NAME" >/dev/null 2>&1 || true
    docker run -d \
      --name "$CLOUDFLARED_CONTAINER_NAME" \
      --restart unless-stopped \
      --network host \
      cloudflare/cloudflared:latest \
      tunnel --no-autoupdate --url "http://127.0.0.1:${WEB_PORT}" >/dev/null
  fi

  TUNNEL_URL=""
  for _ in $(seq 1 20); do
    TUNNEL_URL="$(docker logs "$CLOUDFLARED_CONTAINER_NAME" 2>&1 | grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' | tail -n 1 || true)"
    if [[ -n "${TUNNEL_URL:-}" ]]; then
      printf '%s\n' "$TUNNEL_URL" > "$PUBLIC_URL_FILE"
      break
    fi
    sleep 1
  done

  if [[ -n "${TUNNEL_URL:-}" ]]; then
    echo "public https: $TUNNEL_URL"
  else
    echo "public tunnel started, but URL is not available yet"
  fi
fi
