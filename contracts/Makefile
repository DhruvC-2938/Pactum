default: build

all: test build

# Fast inner loop. Runs everything that does not need a compiled Wasm artifact.
test:
	cargo test --workspace

build:
	cargo build --target wasm32-unknown-unknown --release -p registry -p timelock -p upgrade-fixture

# The upgrade tests perform a real executable swap, so they embed a compiled Wasm
# fixture and need the artifacts built first.
test-upgrade: build
	cargo test --workspace --features registry/wasm-tests,timelock/wasm-tests

# What CI runs: the full suite including the real Wasm executable swap.
test-all: test-upgrade

fmt:
	cargo fmt --all

clean:
	cargo clean

.PHONY: default all test build test-upgrade test-all fmt clean
