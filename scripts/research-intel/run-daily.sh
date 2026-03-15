#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs/research-intel"
mkdir -p "$LOG_DIR"

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

  echo "research-intel cron failed: node executable not found" >&2
  return 1
}

NODE_BIN="$(resolve_node)"
RUN_MODE="${RESEARCH_INTEL_RUN_MODE:-direct}"
TIMEZONE="Asia/Shanghai"
TODAY="$(date +%F)"
while IFS='=' read -r key value; do
  case "$key" in
    TIMEZONE) TIMEZONE="$value" ;;
    TODAY) TODAY="$value" ;;
  esac
done < <("$NODE_BIN" "$SCRIPT_DIR/print-schedule-env.js" --project-dir "$PROJECT_DIR")
LOG_FILE="$LOG_DIR/cron-$TODAY.log"

{
  echo "[$(date --iso-8601=seconds)] research-intel cron start (mode=$RUN_MODE timezone=$TIMEZONE)"
  cd "$PROJECT_DIR"
  if [[ "$RUN_MODE" == "codex" ]]; then
    "$NODE_BIN" "$SCRIPT_DIR/codex-supervisor.js"
  else
    "$NODE_BIN" "$SCRIPT_DIR/daily-run.js"
  fi
  echo "[$(date --iso-8601=seconds)] research-intel cron done"
} >>"$LOG_FILE" 2>&1
