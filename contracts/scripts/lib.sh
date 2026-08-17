#!/usr/bin/env bash
# Shared configuration and helpers for the Pactum upgrade scripts.
#
# Sourced, not executed. Every script that sources this supports --dry-run, which
# prints the exact `stellar` invocations instead of submitting them — use it to review
# a transaction before it touches a live network.

set -euo pipefail

: "${NETWORK:=testnet}"
: "${SOURCE:=}"
: "${TIMELOCK_ID:=}"
: "${REGISTRY_ID:=}"

DRY_RUN=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM_DIR="${CONTRACTS_DIR}/target/wasm32-unknown-unknown/release"

log()  { printf '%s\n' "$*" >&2; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

# Strips --dry-run from the arguments, leaving the rest in the global ARGS array.
#
# Deliberately communicates through globals rather than stdout: a command substitution
# would run this in a subshell, where setting DRY_RUN has no effect on the caller and
# every script would silently submit real transactions when asked to dry-run.
# Callers use:  parse_common_flags "$@"; set -- "${ARGS[@]+"${ARGS[@]}"}"
ARGS=()
parse_common_flags() {
  ARGS=()
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY_RUN=1 ;;
      *) ARGS+=("$arg") ;;
    esac
  done
}

require_env() {
  local missing=()
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if (( ${#missing[@]} > 0 )); then
    die "set these environment variables first: ${missing[*]}"
  fi
}

require_stellar_cli() {
  if (( DRY_RUN == 1 )); then
    return 0
  fi
  command -v stellar >/dev/null 2>&1 \
    || die "the 'stellar' CLI is not on PATH. Install it, or re-run with --dry-run to print the commands."
}

# Runs a command, or prints it verbatim under --dry-run.
run() {
  if (( DRY_RUN == 1 )); then
    printf 'DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

# Runs a command and captures stdout, or prints it and returns a placeholder under
# --dry-run so downstream steps stay reviewable.
run_capture() {
  local placeholder="$1"; shift
  if (( DRY_RUN == 1 )); then
    printf 'DRY-RUN:' >&2
    printf ' %q' "$@" >&2
    printf '\n' >&2
    printf '%s' "$placeholder"
    return 0
  fi
  "$@"
}

invoke() {
  local contract_id="$1"; shift
  run stellar contract invoke \
    --id "$contract_id" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- "$@"
}

invoke_capture() {
  local placeholder="$1"; shift
  local contract_id="$1"; shift
  run_capture "$placeholder" stellar contract invoke \
    --id "$contract_id" \
    --source "$SOURCE" \
    --network "$NETWORK" \
    -- "$@"
}
