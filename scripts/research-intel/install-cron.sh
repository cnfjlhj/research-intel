#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUN_SCRIPT="$SCRIPT_DIR/run-daily.sh"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-daily.sh"
SCHEDULE_SCRIPT="$SCRIPT_DIR/print-schedule-env.js"
BLOCK_START="# >>> research-intel >>>"
BLOCK_END="# <<< research-intel <<<"
LEGACY_DAILY_MARKER="research-intel-daily"
LEGACY_VERIFY_MARKER="research-intel-daily-verify"

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

  echo "research-intel cron install failed: node executable not found" >&2
  return 1
}

chmod +x "$RUN_SCRIPT"
chmod +x "$VERIFY_SCRIPT"
NODE_BIN="$(resolve_node)"

TIMEZONE="Asia/Shanghai"
SEND_TIME="06:00"
VERIFY_TIME="06:40"
CRON_LINE=""
VERIFY_CRON_LINE=""

while IFS='=' read -r key value; do
  case "$key" in
    TIMEZONE) TIMEZONE="$value" ;;
    SEND_TIME) SEND_TIME="$value" ;;
    VERIFY_TIME) VERIFY_TIME="$value" ;;
    DAILY_CRON_LINE) CRON_LINE="$value" ;;
    VERIFY_CRON_LINE) VERIFY_CRON_LINE="$value" ;;
  esac
done < <(
  "$NODE_BIN" "$SCHEDULE_SCRIPT" \
    --project-dir "$PROJECT_DIR" \
    --run-script "$RUN_SCRIPT" \
    --verify-script "$VERIFY_SCRIPT"
)

CURRENT_CRONTAB="$(crontab -l 2>/dev/null || true)"

{
  printf '%s\n' "$CURRENT_CRONTAB" | awk \
    -v start="$BLOCK_START" \
    -v end="$BLOCK_END" \
    -v legacyDaily="$LEGACY_DAILY_MARKER" \
    -v legacyVerify="$LEGACY_VERIFY_MARKER" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    index($0, legacyDaily) { next }
    index($0, legacyVerify) { next }
    !skip { print }
  '
  printf '%s\n' "$BLOCK_START"
  printf '%s\n' "CRON_TZ=$TIMEZONE"
  printf '%s\n' "$CRON_LINE"
  printf '%s\n' "$VERIFY_CRON_LINE"
  printf '%s\n' "$BLOCK_END"
} | awk 'NF {print}' | crontab -

echo "Installed research-intel cron:"
echo "timezone: $TIMEZONE"
echo "daily: $SEND_TIME"
echo "verify: $VERIFY_TIME"
crontab -l | awk -v start="$BLOCK_START" -v end="$BLOCK_END" '
  $0 == start { show = 1 }
  show { print }
  $0 == end { show = 0 }
'
