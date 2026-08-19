default: build

all: test build

test:
	cargo test

build:
	cargo build --target wasm32-unknown-unknown --release

# The upgrade tests need compiled Wasm artifacts from every workspace crate, so they
# are driven from the workspace Makefile.
test-upgrade:
	$(MAKE) -C .. test-upgrade

.PHONY: default all test build test-upgrade
