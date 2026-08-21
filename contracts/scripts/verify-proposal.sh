#!/usr/bin/env bash
# The integrator-facing half of the runbook: read a queued proposal and check it
# against a locally reproduced build.
#
# This is what makes the 7-day window mean something. If the hash the DAO queued does
# not match the hash you get from building the published source yourself, the code that
# will execute is not the code you were shown — and you have the rest of the window to
# raise it, ask the guardian to veto, or migrate off the registry.
#
# Read-only: it never signs or submits anything.
#
# Usage:
#   NETWORK=testnet SOURCE=any-key TIMELOCK_ID=C... \
#     ./verify-proposal.sh <proposal-id> [--wasm path/to/locally-built.wasm] [--dry-run]

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"
set -- "${ARGS[@]+"${ARGS[@]}"}"

PROPOSAL_ID="${1:-}"
[[ -n "$PROPOSAL_ID" ]] || die "usage: $0 <proposal-id> [--wasm <file>] [--dry-run]"
shift || true

LOCAL_WASM=""
while (( $# > 0 )); do
  case "$1" in
    --wasm) LOCAL_WASM="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

require_env NETWORK SOURCE TIMELOCK_ID
require_stellar_cli

log "==> Proposal ${PROPOSAL_ID} as recorded on chain"
invoke "$TIMELOCK_ID" get_proposal --id "$PROPOSAL_ID"

log ""
log "==> Is it executable right now?"
invoke "$TIMELOCK_ID" is_executable --id "$PROPOSAL_ID"

log ""
log "==> Enforced minimum delay (a constant in the executable, not a stored setting)"
invoke "$TIMELOCK_ID" min_delay

if [[ -n "$LOCAL_WASM" ]]; then
  [[ -f "$LOCAL_WASM" ]] || die "no such file: $LOCAL_WASM"
  log ""
  log "==> Your local build"
  log "    file:   $LOCAL_WASM"
  log "    sha256: $(sha256sum "$LOCAL_WASM" | cut -d' ' -f1)"
  log ""
  log "Compare the Wasm hash inside the Upgrade action above against your local build."
  log "They must match exactly. If they do not, treat the proposal as unreviewed."
else
  log ""
  log "Re-run with --wasm <file> to print your local build's hash for comparison."
fi

log ""
log "Checklist for the review window:"
log "  1. Does the pinned Wasm hash match a build you reproduced from published source?"
log "  2. Does description_hash match the rationale document the DAO published?"
log "  3. Does the schema version in the action match what that source expects?"
log "  4. Is 'eta' at least 7 days after 'queued_at'?"
log "  5. If any answer is no: ask the guardian to cancel, and stop relying on the"
log "     registry's Trust Scores until it is resolved."
