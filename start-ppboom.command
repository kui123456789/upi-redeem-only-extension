#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

SERVICE_DIR="services/ppboom"
HELPER_SCRIPT="$SERVICE_DIR/app.py"
REQUIREMENTS_FILE="$SERVICE_DIR/requirements.txt"
LOG_DIR="data"
START_LOG="$LOG_DIR/ppboom-start.log"
DEFAULT_HOST="127.0.0.1"
DEFAULT_PORT="8787"
PYTHON_EXE=""

mkdir -p "$LOG_DIR"

log_line() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$START_LOG"
}

pause_for_exit() {
  read -r -p "Press Enter to exit..."
}

usage() {
  cat <<'USAGE'
Usage:
  ./start-ppboom.command
  ./start-ppboom.command 8787

No arguments: start PPBoom on the default port 8787.
USAGE
}

resolve_python() {
  if [[ -x "$SCRIPT_DIR/python/bin/python3" ]]; then
    PYTHON_EXE="$SCRIPT_DIR/python/bin/python3"
    log_line "using bundled python/bin/python3"
    return 0
  fi

  if [[ -x "$SCRIPT_DIR/.runtime/python/bin/python3" ]]; then
    PYTHON_EXE="$SCRIPT_DIR/.runtime/python/bin/python3"
    log_line "using bundled .runtime/python/bin/python3"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    PYTHON_EXE="$(command -v python3)"
    return 0
  fi

  if command -v python >/dev/null 2>&1; then
    PYTHON_EXE="$(command -v python)"
    return 0
  fi

  return 1
}

validate_python_version() {
  "$PYTHON_EXE" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}

validate_port() {
  local port="${1:-}"
  local port_num=0

  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  if (( ${#port} > 5 )); then
    return 1
  fi

  port_num=$((10#$port))
  if (( port_num < 1 || port_num > 65535 )); then
    return 1
  fi

  return 0
}

cleanup_existing_helper() {
  local port="$1"
  local pids=""
  local pid=""

  if ! command -v lsof >/dev/null 2>&1; then
    log_line "lsof not found; skipping port cleanup for $port"
    return 0
  fi

  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  for pid in $pids; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" != "$$" ]]; then
      log_line "stopping existing listener on port $port pid=$pid"
      echo "Stopping existing PPBoom listener on port $port (PID $pid)..."
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done

  sleep 1

  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in $pids; do
    if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$pid" != "$$" ]]; then
      log_line "force stopping existing listener on port $port pid=$pid"
      kill -9 "$pid" >/dev/null 2>&1 || return 1
    fi
  done

  return 0
}

print_start_info() {
  local port="$1"

  echo
  echo "GuJumpgate PPBoom"
  echo "------------------------------------------------------------"
  echo "Folder: $SCRIPT_DIR"
  echo "Python: $PYTHON_EXE"
  "$PYTHON_EXE" --version
  if [[ -n "${OPENAI_PAY_DEFAULT_PROXY:-}" ]]; then
    echo "Initial Proxy: configured via OPENAI_PAY_DEFAULT_PROXY"
  else
    echo "Initial Proxy: direct connection (OPENAI_PAY_DEFAULT_PROXY not set)"
  fi
  if [[ -n "${OPENAI_PAY_PROVIDER_PROXY:-}" ]]; then
    echo "Provider Proxy: configured via OPENAI_PAY_PROVIDER_PROXY"
  else
    echo "Provider Proxy: request/default fallback, or direct if none configured"
  fi
  echo "Helper: http://$DEFAULT_HOST:$port"
  echo "Check:  http://$DEFAULT_HOST:$port/health"
  echo "Log:    $SCRIPT_DIR/$START_LOG"
  echo "------------------------------------------------------------"
  echo "Keep this window open while GuJumpgate is running."
  echo
}

run_single() {
  local port="$1"
  local helper_exit_code=0

  print_start_info "$port"
  if ! cleanup_existing_helper "$port"; then
    echo
    echo "Failed to stop the existing process on port $port."
    echo "Please close the old PPBoom window or stop the process manually, then run this script again."
    echo
    pause_for_exit
    exit 1
  fi

  log_line "starting ppboom on port $port"
  "$PYTHON_EXE" -m uvicorn services.ppboom.app:app --host "$DEFAULT_HOST" --port "$port"
  helper_exit_code=$?
  log_line "ppboom exited with code $helper_exit_code"

  if [[ "$helper_exit_code" != "0" ]]; then
    echo
    echo "PPBoom failed to start. Exit code: $helper_exit_code"
    echo
    echo "Common causes:"
    echo "  1. Python is not installed or is older than 3.10."
    echo "  2. The required modules are not installed. Run:"
    echo "     $PYTHON_EXE -m pip install -r $REQUIREMENTS_FILE"
    echo "  3. Port $port is already in use."
    echo
    pause_for_exit
  fi

  exit "$helper_exit_code"
}

log_line "launcher opened"

case "${1:-}" in
  -h|--help|"/?")
    usage
    exit 0
    ;;
esac

if ! resolve_python; then
  log_line "python not found"
  echo "Python 3 not found. Please install Python 3.10+ and try again."
  pause_for_exit
  exit 1
fi

if ! validate_python_version; then
  log_line "python too old or unusable"
  echo "Python 3.10+ is required to run PPBoom."
  "$PYTHON_EXE" --version
  pause_for_exit
  exit 1
fi

if [[ ! -f "$HELPER_SCRIPT" || ! -f "$REQUIREMENTS_FILE" ]]; then
  log_line "helper files not found"
  echo "PPBoom helper files were not found."
  echo "Please run start-ppboom.command from the GuJumpgate folder."
  pause_for_exit
  exit 1
fi

PORT="${1:-$DEFAULT_PORT}"
if ! validate_port "$PORT"; then
  log_line "invalid port $PORT"
  echo
  echo "Invalid helper port: $PORT"
  echo "Port must be a number from 1 to 65535."
  pause_for_exit
  exit 1
fi

run_single "$PORT"
