#!/usr/bin/env bash
# Step 2 of the upgrade runbook: apply a matured proposal.
#
# This is the atomic upgrade transaction. In one invocation the registry records the
# new storage schema version and replaces its executable; either both land or neither
# does. The contract ID does not change and no stored entry is touched.
#
# What this does NOT do is rewrite existing reputation rows — that cannot fit in one
# transaction once there is real data, and is handled by migrate-reputation.sh. See
# docs/upgradeability.md for why the schema switch is the part that has to be atomic.
#
# Usage:
#   NETWORK=testnet SOURCE=dao-key TIMELOCK_ID=C... REGISTRY_ID=C... \
#     ./execute-upgrade.sh <proposal-id> [--dry-run]

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"
set -- "${ARGS[@]+"${ARGS[@]}"}"

PROPOSAL_ID="${1:-}"
[[ -n "$PROPOSAL_ID" ]] || die "usage: $0 <proposal-id> [--dry-run]"

require_env NETWORK SOURCE TIMELOCK_ID REGISTRY_ID
require_stellar_cli

log "==> Proposal ${PROPOSAL_ID} before execution"
invoke "$TIMELOCK_ID" get_proposal --id "$PROPOSAL_ID"

log ""
log "==> Confirming the delay has elapsed and the grace period has not"
invoke "$TIMELOCK_ID" is_executable --id "$PROPOSAL_ID"
log "    (if the line above is not 'true', stop here — execution will be rejected)"

log ""
log "==> Registry schema version before"
invoke "$REGISTRY_ID" schema_version

log ""
log "==> Executing"
invoke "$TIMELOCK_ID" execute --caller "$SOURCE" --id "$PROPOSAL_ID"

log ""
log "==> Registry schema version after"
invoke "$REGISTRY_ID" schema_version

log ""
log "Upgraded. Existing Trust Scores are unchanged and served under the new schema"
log "whether or not their rows have physically been rewritten yet."
log ""
log "Next: drain the migration backlog with"
log "  ./migrate-reputation.sh <addresses-file> [--dry-run]"
