# Astra Name Service (astra-ns)

**Human-readable names for Stellar addresses — turn `GAJG7C...Y27ES` into `aman.xlm`.**

Astra Name Service (ANS) is an open, on-chain naming registry for the Stellar network, built on Soroban. It lets anyone register a short, memorable name and point it at their Stellar address — and lets any wallet, dApp, or contract resolve that name back to an address in a single call.

[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-7D00FF)](https://soroban.stellar.org)
[![Network](https://img.shields.io/badge/Network-Stellar%20Testnet-08B5E5)](https://stellar.org)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

---

## Why Astra?

Stellar addresses are 56-character strings (`G...`). They're impossible to remember, easy to mistype, and unfriendly to share. Other chains solved this years ago — Ethereum has ENS, Solana has SNS — but Stellar has never had a strong, general-purpose name service.

Astra fixes that: a simple registry contract plus a lightweight API/SDK so any wallet or app can resolve `alice.xlm → GABCDEF...` in one request.

---

## How it works

```
 register("aman.xlm", owner, 1 year)
              │
              ▼
     ┌─────────────────┐
     │  Registry        │   on-chain source of truth
     │  Contract        │   (Soroban, Rust)
     └────────┬─────────┘
              │ events
              ▼
     ┌─────────────────┐
     │  Indexer          │   watches events, builds a
     │  (backend)         │   fast lookup cache
     └────────┬─────────┘
              │
              ▼
     ┌─────────────────┐
     │  REST API          │   GET /resolve/aman.xlm
     │  + JS SDK           │   → GABCDEF...Y27ES
     └─────────────────┘
```

1. **Register** — a user claims a name on-chain, paying a small XLM fee, for a chosen duration.
2. **Resolve** — anyone (a wallet, a dApp, another contract) looks up the name and gets back the current owner's address.
3. **Renew / Transfer** — owners renew before expiry or transfer ownership to someone else.
4. **Records** — owners can attach optional metadata to their name (avatar URL, social handles, a secondary address for a different asset, etc.).

---

## Project structure

```
astra-ns/
├── contracts/registry/     # Soroban smart contract (Rust)
├── backend/                # REST API + on-chain event indexer (TypeScript)
├── sdk/js/                 # Lightweight JS/TS SDK for dApp & wallet integration
├── docs/                   # Architecture, contract & API reference, integration guide
└── examples/                # Minimal integration demo
```

See [`docs/architecture.md`](./docs/architecture.md) for the full breakdown.

---

## Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Rust + Soroban SDK |
| Contract network | Stellar Testnet |
| Backend API | Node.js + TypeScript + Express |
| Indexer | Soroban RPC event listener |
| Database | PostgreSQL |
| SDK | TypeScript, published as `@astra-ns/sdk` |
| Testing | Cargo test (contract) · Jest (backend) |
| CI/CD | GitHub Actions |

---

## Contract interface (early draft)

| Method | Kind | Description |
|---|---|---|
| `register(name, owner, duration)` | write | Claim a new name, pay the registration fee |
| `resolve(name)` | read | Return the address currently owned by `name` |
| `reverse_resolve(address)` | read | Return the primary name pointing at `address` |
| `renew(name, duration)` | write | Extend a name's expiry |
| `transfer(name, new_owner)` | write | Transfer ownership of a name |
| `set_record(name, key, value)` | write | Attach metadata to a name |
| `is_available(name)` | read | Check if a name is unclaimed or expired |

Full spec lives in [`docs/contract-reference.md`](./docs/contract-reference.md) as the contract develops.

---

## Getting started (local dev)

**Prerequisites:** Rust + Cargo, `soroban-cli`, Node.js 18+, PostgreSQL

```bash
# 1. Clone
git clone https://github.com/<your-username>/astra-ns.git
cd astra-ns

# 2. Build & test the contract
cd contracts && cargo test

# 3. Set up the backend
cd ../backend
npm install
cp .env.example .env      # fill in DATABASE_URL, SOROBAN_RPC_URL, etc.
npm run migrate:latest
npm run dev
```

---

## Roadmap

- [ ] Core registry contract — register / resolve / renew / transfer
- [ ] Multi-record support (multiple addresses/metadata per name)
- [ ] Subdomains (`shop.aman.xlm`)
- [ ] Expiry grace period before a name is released
- [ ] Premium/short-name auction system
- [ ] REST API + on-chain indexer
- [ ] JS/TS SDK (`@astra-ns/sdk`)
- [ ] Wallet integration example
- [ ] Rate limiting & anti-squatting protections
- [ ] Public resolver dashboard (names registered, lookups over time)

Open an issue if you'd like to pick up any of these — contributions welcome.

---

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for local setup, coding conventions, and how to submit a pull request.

## Security

Found a vulnerability? Please see [`SECURITY.md`](./SECURITY.md) for responsible disclosure.

## License

MIT — see [`LICENSE`](./LICENSE).
