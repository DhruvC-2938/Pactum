# `@pactum/cli` ⚡

> Terminal CLI tool for the **Pactum Trust Layer** — built for power users, bots, and automated developer workflows.

---

## 📦 Features

- 🔐 **Secure Local Keychain (`auth`)**: Securely stores Stellar private keys in `~/.pactum/config.json` with strict POSIX `0600` file permissions.
- 🏆 **On-Chain Reputation (`reputation get`)**: Inspect real-time Soroban trust scores and commitment fulfillment history (fulfilled, late, breached).
- 📋 **Formatted Commitments Table (`commitments list`)**: Print beautiful ASCII tables of recent commitments, counterparties, statuses, and due dates directly in your terminal.
- ⚡ **Direct SDK Integration**: Built on top of `@pactum/sdk` and Soroban RPC.
- 🤖 **Machine-Readable JSON**: Pass `--json` to any command for integration into CI/CD, scripts, and Discord/Telegram bots.

---

## 🚀 Installation & Setup

From the monorepo root:

```bash
npm install
npm run build --workspace=@pactum/cli
```

To link the binary globally for local development:

```bash
npm link --workspace=@pactum/cli
```

---

## 🛠 Commands

### 1. Authenticate / Store Secret Key

Store your secret key in a secure local config:

```bash
pactum auth SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Options:**
- `--network <network>`: Associate credentials with `testnet`, `standalone`, or `mainnet` (default: `testnet`).
- `--status`: Display current authentication status and active public address.
- `--clear`: Delete stored credentials.
- `--json`: Output as structured JSON.

---

### 2. Fetch Reputation Score

Query on-chain reputation stats for any Stellar account:

```bash
# Query specific address
pactum reputation get GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Query currently authenticated account
pactum reputation get
```

**Options:**
- `-n, --network <network>`: Target network (`testnet`, `standalone`, `mainnet`).
- `--rpc-url <url>`: Custom Soroban RPC endpoint.
- `--contract-id <id>`: Custom Pactum registry contract address.
- `--json`: Output as raw JSON.

**Output Example:**
```text
  Pactum Trust Layer — Reputation Scorecard

  Target Address:   GB4UFB7S4CZ6YJ4G77HHZX4C3R7L64UK7Q
  Network:          testnet
  Trust Score:       92 / 100 (High Trust) 

  Fulfillment Breakdown:
    ✔ Fulfilled:    12 commitments
    ▲ Late:         1 commitments
    ✖ Breached:     0 commitments
    ━ Total Volume: 13 historical commitments
```

---

### 3. List Commitments

Display an ASCII table of recent commitments:

```bash
# List commitments for an address
pactum commitments list GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# List commitments for active account
pactum commitments list
```

**Options:**
- `-s, --status <status>`: Filter by `Pending`, `Fulfilled`, `Late`, `Breached`, or `Disputed`.
- `-l, --limit <number>`: Limit number of returned commitments (default: 20).
- `--api-url <url>`: Backend API endpoint (default: `http://localhost:3000`).
- `--json`: Output as JSON with `address`, `count`, and `commitments` fields.

**Output Example:**
```text
┌────────┬────────────────┬────────────────┬──────────────┬──────────────────┬────────────┐
│ ID     │ Issuer         │ Counterparty   │ Status       │ Due Date (UTC)   │ Encrypted  │
├────────┼────────────────┼────────────────┼──────────────┼──────────────────┼────────────┤
│ #4     │ GCJUKU...A6V4  │ GB4UFB...HHZX  │ Pending      │ 2026-08-30 14:00 │ No         │
│ #3     │ GB4UFB...HHZX  │ GAJKUM...7S4C  │ Fulfilled    │ 2026-08-20 12:30 │ 🔒 Yes     │
└────────┴────────────────┴────────────────┴──────────────┴──────────────────┴────────────┘
```

---

## 🧪 Testing

Run test suites for CLI commands, parsing, and security permissions:

```bash
npm run test --workspace=@pactum/cli
```
