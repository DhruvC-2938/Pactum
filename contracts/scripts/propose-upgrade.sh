#!/usr/bin/env bash
# Step 1 of the upgrade runbook: build the new executable, upload it, and queue the
# upgrade in the timelock. Starts the 7-day review window.
#
# Nothing changes about the registry's behaviour here. All this does is publish, on
# chain, exactly which bytes are proposed and the earliest instant they may be applied.
#
# Usage:
#   NETWORK=testnet SOURCE=dao-key TIMELOCK_ID=C... REGISTRY_ID=C... \
#     ./propose-upgrade.sh <schema-version> <description-hash-hex> [--dry-run]
#
#   schema-version        Storage schema the new executable expects (1 = V1, 2 = V2).
#                         Pass the current version for a code-only bug-fix release.
#   description-hash-hex  64 hex chars: the SHA-256 of the upgrade rationale document
#                         (diff, audit, vote record). Reviewers check the on-chain
#                         proposal against this, so publish the document alongside it.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"
set -- "${ARGS[@]+"${ARGS[@]}"}"

SCHEMA_VERSION="${1:-}"
DESCRIPTION_HASH="${2:-}"

[[ -n "$SCHEMA_VERSION" ]] || die "usage: $0 <schema-version> <description-hash-hex> [--dry-run]"
[[ -n "$DESCRIPTION_HASH" ]] || die "usage: $0 <schema-version> <description-hash-hex> [--dry-run]"
[[ "$SCHEMA_VERSION" =~ ^[1-9][0-9]*$ ]] || die "schema-version must be a positive integer, got '$SCHEMA_VERSION'"
[[ "$DESCRIPTION_HASH" =~ ^[0-9a-fA-F]{64}$ ]] || die "description-hash must be 64 hex characters"

require_env NETWORK SOURCE TIMELOCK_ID REGISTRY_ID
require_stellar_cli

WASM="${WASM:-${WASM_DIR}/registry.wasm}"

log "==> Building the release artifact"
run make -C "$CONTRACTS_DIR" build

[[ -f "$WASM" || $DRY_RUN -eq 1 ]] || die "expected a built artifact at $WASM"

# Publish the local hash so reviewers can reproduce the build and compare. This is the
# value the 7-day window exists to let people check.
if [[ -f "$WASM" ]]; then
  log "==> Local artifact: $WASM"
  log "    sha256: $(sha256sum "$WASM" | cut -d' ' -f1)"
fi

log "==> Uploading the executable"
WASM_HASH="$(run_capture "<wasm-hash>" stellar contract upload \
  --wasm "$WASM" \
  --source "$SOURCE" \
  --network "$NETWORK")"
WASM_HASH="$(printf '%s' "$WASM_HASH" | tr -d '[:space:]')"
log "    wasm hash: $WASM_HASH"

# Uploading is deliberately separate from queueing: the blob has to exist on the ledger
# before `upgrade` can reference it, and having it uploaded during the review window
# means reviewers can fetch the exact bytes rather than taking the hash on trust.

log "==> Queueing the upgrade proposal (starts the 7-day delay)"
invoke "$TIMELOCK_ID" queue \
  --proposer "$SOURCE" \
  --target "$REGISTRY_ID" \
  --action "{\"Upgrade\":[\"${WASM_HASH}\",${SCHEMA_VERSION}]}" \
  --description_hash "$DESCRIPTION_HASH"

log ""
log "Queued. Next steps:"
log "  * Publish the rationale document whose SHA-256 is ${DESCRIPTION_HASH}."
log "  * Integrators verify with: ./verify-proposal.sh <proposal-id>"
log "  * After 7 days:            ./execute-upgrade.sh <proposal-id> [--dry-run]"
log "  * To withdraw or veto:     stellar contract invoke --id ${TIMELOCK_ID} -- cancel ..."
