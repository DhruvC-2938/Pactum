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

# The CLI binary is `stellar` (renamed from `soroban` -- the older
# `soroban-cli` project is now `stellar-cli`, installed via prebuilt release
# binary in CI rather than `cargo install`, see .github/workflows/e2e-sandbox.yml).
CLI="stellar"
if ! command -v "$CLI" &> /dev/null; then
  echo "ERROR: '$CLI' CLI not found on PATH." >&2
  echo "Install with: curl -sSLO https://github.com/stellar/stellar-cli/releases/latest/download/stellar-cli-x86_64-unknown-linux-gnu.tar.gz && tar -xzf stellar-cli-*.tar.gz && sudo mv stellar /usr/local/bin/" >&2
  exit 1
fi
echo "Using CLI: ${CLI} ($($CLI --version))"

NETWORK="local"
RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"

CONTRACT_DIR="contracts"           # workspace root -- confirmed via contracts/Cargo.toml's [workspace] section

# Contracts now build with `stellar contract build`, NOT `cargo build`
# directly -- stellar-cli applies the wasm32v1-none-specific build settings
# the Soroban runtime requires (reference-types/multi-value features must
# stay disabled, which cargo build alone won't enforce on newer Rust).
# wasm32v1-none replaces the older wasm32-unknown-unknown target, which is
# no longer supported for Soroban contracts on Rust 1.82+.
#
# IMPORTANT: contracts/ is a Cargo workspace (contracts/Cargo.toml has
# [workspace], confirmed) with multiple members (registry, timelock,
# mock_resolver, upgrade-fixture, validation) -- build output lands in the
# *workspace's* target/ dir, i.e. contracts/target/, NOT
# contracts/registry/target/.
# Cargo derives the wasm filename from the package's [package] name field
# (confirmed as "registry" via contracts/registry/Cargo.toml), not from the
# Rust struct name (RegistryContract) -- so the output is registry.wasm,
# not pactum_registry.wasm as originally guessed.
WASM_PATH="${CONTRACT_DIR}/target/wasm32v1-none/release/registry.wasm"

# Identities. `arbitrator` doubles as the sole member of the arbitrator
# committee for test purposes (RegistryContract::initialize takes a Vec, but
# a single-member committee is enough to exercise resolve_dispute).
IDENTITIES=(issuer counterparty arbitrator resolver)

echo "== Configuring local network =="
$CLI network add "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" || true

echo "== Generating + funding test identities =="
for id in "${IDENTITIES[@]}"; do
  $CLI keys generate "$id" --network "$NETWORK" --overwrite
  $CLI keys fund "$id" --network "$NETWORK"
  echo "  funded: ${id} -> $($CLI keys address "$id")"
done

echo "== Building contract (stellar contract build, wasm32v1-none) =="
# Package name confirmed as "registry" via contracts/registry/Cargo.toml's
# [package] name field -- scoping the build to it skips building
# timelock/mock_resolver/upgrade-fixture/validation, which aren't needed here.
(cd "$CONTRACT_DIR" && $CLI contract build -p registry)

if [ ! -f "$WASM_PATH" ]; then
  echo "ERROR: expected wasm not found at ${WASM_PATH}" >&2
  echo "Run 'find ${CONTRACT_DIR}/target -name \"*.wasm\"' to see what 'stellar contract build' actually produced," >&2
  echo "the exact output filename depends on the crate's [package] name in Cargo.toml -- adjust WASM_PATH above to match." >&2
  exit 1
fi

echo "== Deploying contract =="
CONTRACT_ID=$($CLI contract deploy \
  --wasm "$WASM_PATH" \
  --source issuer \
  --network "$NETWORK")

echo "Deployed contract: ${CONTRACT_ID}"

ARBITRATOR_ADDR=$($CLI keys address arbitrator)

echo "== Initializing arbitrator committee =="
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
