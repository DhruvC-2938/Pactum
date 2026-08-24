#!/usr/bin/env bash
# Blocks until the local Soroban sandbox's RPC endpoint is responding.
# Used in CI and locally so we don't race the deploy script against a
# container that's still booting.

set -euo pipefail

RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
MAX_ATTEMPTS=30
SLEEP_SECONDS=2

echo "Waiting for Soroban sandbox RPC at ${RPC_URL} ..."

for i in $(seq 1 "$MAX_ATTEMPTS"); do
  if curl -sf -X POST "$RPC_URL" \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      | grep -q '"status":"healthy"'; then
    
    # Quickstart can sometimes have RPC healthy before Friendbot is ready.
    # We check if Friendbot returns a JSON response (like the 400 Bad Request for missing addr)
    if curl -s "http://localhost:8000/friendbot" | grep -q '"title"'; then
      echo "Sandbox RPC and Friendbot are healthy after ${i} attempt(s)."
      exit 0
    fi
  fi
  echo "  attempt ${i}/${MAX_ATTEMPTS}: not ready yet, sleeping ${SLEEP_SECONDS}s"
  sleep "$SLEEP_SECONDS"
done

echo "ERROR: Soroban sandbox RPC did not become healthy in time." >&2
exit 1
