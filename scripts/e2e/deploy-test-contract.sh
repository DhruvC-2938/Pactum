#!/usr/bin/env bash
# Deploys the Pactum RegistryContract to a local Soroban sandbox for E2E
# tests, funds test identities, initializes the arbitrator committee, and
# writes the resulting env vars to .env.e2e for docker-compose.e2e.yml and
# the frontend build to pick up.
#
# Run after the sandbox is healthy:
#   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d soroban
#   ./scripts/e2e/wait-for-rpc.sh
#   ./scripts/e2e/deploy-test-contract.sh

set -euo pipefail

# The CLI binary has been renamed from `soroban` to `stellar` in newer
# releases (stellar-cli). Auto-detect whichever is actually installed
# rather than hardcoding one -- confirmed via `soroban: command not found`
# during initial local testing against this repo.
if command -v stellar &> /dev/null; then
  CLI="stellar"
elif command -v soroban &> /dev/null; then
  CLI="soroban"
else
  echo "ERROR: neither 'stellar' nor 'soroban' CLI found on PATH." >&2
  echo "Install with: cargo install --locked stellar-cli" >&2
  exit 1
fi
echo "Using CLI: ${CLI}"

NETWORK="local"
RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"

CONTRACT_DIR="contracts/registry"
WASM_PATH="${CONTRACT_DIR}/target/wasm32-unknown-unknown/release/pactum_registry.wasm"

# Identities. `arbitrator` doubles as the sole member of the arbitrator
# committee for test purposes (RegistryContract::initialize takes a Vec, but
# a single-member committee is enough to exercise resolve_dispute).
IDENTITIES=(issuer counterparty arbitrator resolver)

echo "== Configuring local network =="
$CLI network add "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" \
  --allow-http || true

echo "== Generating + funding test identities =="
for id in "${IDENTITIES[@]}"; do
  $CLI keys generate "$id" --network "$NETWORK" --overwrite
  $CLI keys fund "$id" --network "$NETWORK"
  echo "  funded: ${id} -> $($CLI keys address "$id")"
done

echo "== Building contract =="
(cd "$CONTRACT_DIR" && $CLI contract build)

echo "== Deploying contract =="
CONTRACT_ID=$($CLI contract deploy \
  --wasm "$WASM_PATH" \
  --source issuer \
  --network "$NETWORK")

echo "Deployed contract: ${CONTRACT_ID}"

ARBITRATOR_ADDR=$($CLI keys address arbitrator)

echo "== Initializing arbitrator committee =="
# initialize(arbitrators: Vec<Address>) requires require_auth from every
# address in the set -- with a single-member committee, --source arbitrator
# covers it.
$CLI contract invoke \
  --id "$CONTRACT_ID" \
  --source arbitrator \
  --network "$NETWORK" \
  -- initialize \
  --arbitrators "[\"${ARBITRATOR_ADDR}\"]"

echo "== Writing .env.e2e =="
cat > .env.e2e <<EOF
SOROBAN_RPC_URL=${RPC_URL}
SOROBAN_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
SOROBAN_CONTRACT_ID=${CONTRACT_ID}

VITE_SOROBAN_RPC_URL=${RPC_URL}
VITE_STELLAR_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}
VITE_PACTUM_CONTRACT_ID=${CONTRACT_ID}

E2E_ISSUER_ADDRESS=$($CLI keys address issuer)
E2E_ISSUER_SECRET=$($CLI keys show issuer)
E2E_COUNTERPARTY_ADDRESS=$($CLI keys address counterparty)
E2E_COUNTERPARTY_SECRET=$($CLI keys show counterparty)
E2E_ARBITRATOR_ADDRESS=${ARBITRATOR_ADDR}
E2E_ARBITRATOR_SECRET=$($CLI keys show arbitrator)
E2E_RESOLVER_ADDRESS=$($CLI keys address resolver)
E2E_RESOLVER_SECRET=$($CLI keys show resolver)
EOF

echo "Done. .env.e2e written."
echo ""
echo "NOTE: E2E_*_SECRET values are local-sandbox-only test keys with no"
echo "real value -- fine to write to a gitignored .env.e2e, never commit them."
