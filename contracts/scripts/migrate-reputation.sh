#!/usr/bin/env bash
# Step 3 of the upgrade runbook: rewrite V1 reputation rows into the V2 layout.
#
# Why this is a separate, batched script rather than part of the upgrade transaction:
# iterating every scored address inside the upgrade invocation makes the cost of an
# upgrade proportional to the size of the ledger's history, which exceeds Soroban's
# per-transaction resource limits as soon as there is real data. What the upgrade
# transaction does make atomic is the *schema switch*, so reads are served under V2
# semantics from the instant it lands regardless of how much of this has run.
#
# Running this is therefore an optimisation, not a correctness requirement:
#   * Reads already return correct V2 data for un-migrated addresses, projected on
#     the fly.
#   * Any address that is written to migrates itself on the way past.
# This script exists so the backlog gets drained on a schedule instead of leaving rows
# in the old layout indefinitely. It is idempotent and safe to re-run.
#
# `migrate_reputation_batch` is permissionless, so this does not need the DAO key —
# any funded account can run it.
#
# Usage:
#   NETWORK=testnet SOURCE=any-key REGISTRY_ID=C... \
#     ./migrate-reputation.sh <addresses-file> [--batch-size N] [--dry-run]
#
#   addresses-file  One G... address per line. Blank lines and #-comments ignored.
#                   Build it from the indexer: every address that has ever appeared as
#                   an issuer has a reputation row.

source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
parse_common_flags "$@"
set -- "${ARGS[@]+"${ARGS[@]}"}"

ADDRESSES_FILE="${1:-}"
[[ -n "$ADDRESSES_FILE" ]] || die "usage: $0 <addresses-file> [--batch-size N] [--dry-run]"
shift || true

# Below the contract's own limit of 100, because the binding constraint in practice is
# the network's per-transaction resource metering, not the contract's guard.
BATCH_SIZE=25
CONTRACT_MAX_BATCH=100

while (( $# > 0 )); do
  case "$1" in
    --batch-size) BATCH_SIZE="${2:-}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$BATCH_SIZE" =~ ^[1-9][0-9]*$ ]] || die "--batch-size must be a positive integer"
(( BATCH_SIZE <= CONTRACT_MAX_BATCH )) \
  || die "--batch-size must be at most ${CONTRACT_MAX_BATCH}; the contract rejects larger batches with BatchTooLarge"
[[ -f "$ADDRESSES_FILE" ]] || die "no such file: $ADDRESSES_FILE"

require_env NETWORK SOURCE REGISTRY_ID
require_stellar_cli

FAILED_FILE="${ADDRESSES_FILE}.failed"
: > "$FAILED_FILE"

mapfile -t ADDRESSES < <(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$ADDRESSES_FILE" | grep -v '^$')
TOTAL=${#ADDRESSES[@]}
(( TOTAL > 0 )) || die "no addresses found in $ADDRESSES_FILE"

log "==> ${TOTAL} address(es), batches of ${BATCH_SIZE}"

# Submits one batch. Returns non-zero if the invocation failed.
submit_batch() {
  local json="$1"
  invoke "$REGISTRY_ID" migrate_reputation_batch --addresses "$json"
}

# Builds a JSON array from the addresses at the given indices.
build_json() {
  local -n _idx="$1"
  local out="[" first=1
  for i in "${_idx[@]}"; do
    (( first )) || out+=","
    out+="\"${ADDRESSES[$i]}\""
    first=0
  done
  printf '%s]' "$out"
}

batch_number=0
failed_count=0

for (( start = 0; start < TOTAL; start += BATCH_SIZE )); do
  batch_number=$(( batch_number + 1 ))
  indices=()
  for (( i = start; i < start + BATCH_SIZE && i < TOTAL; i++ )); do
    indices+=("$i")
  done

  json="$(build_json indices)"
  log "==> Batch ${batch_number}: addresses $(( start + 1 ))-$(( start + ${#indices[@]} )) of ${TOTAL}"

  if submit_batch "$json"; then
    continue
  fi

  # A batch fails as a unit, and the most likely cause is one archived entry: touching
  # an archived persistent entry aborts the whole invocation rather than reading as
  # absent. Retry one at a time to isolate which addresses are the problem instead of
  # writing off the whole batch.
  warn "batch ${batch_number} failed; retrying its addresses individually to isolate the cause"
  for i in "${indices[@]}"; do
    addr="${ADDRESSES[$i]}"
    single="[\"${addr}\"]"
    if ! submit_batch "$single"; then
      warn "  ${addr}: failed"
      printf '%s\n' "$addr" >> "$FAILED_FILE"
      failed_count=$(( failed_count + 1 ))
    fi
  done
done

log ""
if (( failed_count > 0 )); then
  log "Done, with ${failed_count} address(es) unmigrated. They are listed in:"
  log "  ${FAILED_FILE}"
  log ""
  log "The usual cause is an archived reputation entry. An archived persistent entry is"
  log "not readable as absent — the transaction is rejected before the contract runs —"
  log "so the contract cannot skip past it and the entry must be restored first:"
  log ""
  log "  stellar contract restore --id ${REGISTRY_ID} --source ${SOURCE} \\"
  log "    --network ${NETWORK} --durability persistent --key-xdr <ScVal of the key>"
  log ""
  log "The key is the ScVal encoding of ReputationKey::Reputation(<address>), i.e. a"
  log "vector of the symbol \"Reputation\" followed by the address. Restore those keys,"
  log "then re-run this script against ${FAILED_FILE}."
  exit 1
fi

log "Done. All ${TOTAL} address(es) processed."
log "Addresses that were already on V2, or were never scored, count as no-ops."
rm -f "$FAILED_FILE"
