# feat(registry): track counterparty-raised frivolous disputes

Closes **#9**

## Description

The `Reputation` struct previously only tracked issuer-side stats
(`fulfilled_count`, `late_count`, `breached_count`), which meant a
counterparty could abuse the dispute window to delay finalization with
**zero on-chain reputational cost**. This PR adds counterparty-side
reputation tracking so baseless disputes carry a consequence.

A counterparty-raised dispute is considered **frivolous** when the
arbitrator rules against the counterparty — i.e. the final outcome
matches the original attested status. Each such dispute now increments a
`counterparty_disputes_raised` counter on the counterparty's reputation.

## What changed

- **`Reputation` struct** (`reputation.rs`)
  - Added `counterparty_disputes_raised: u32` field.
  - Added `increment_counterparty_disputes_raised()` helper (saturating,
    follows the existing TTL-extension pattern).

- **`Commitment` struct** (`commitments.rs`)
  - Added `disputed_from: Option<u32>` — the attested status code at the
    time the dispute was raised.
  - Added `disputed_by: Option<Address>` — the party that raised the
    dispute.

- **`dispute()`** (`disputes.rs`)
  - Records the pre-dispute status (`disputed_from`) and the disputing
    party (`disputed_by`) before transitioning to `Disputed`, so the
    resolution step can determine whether the dispute was justified.

- **`resolve_dispute()`** (`disputes.rs`)
  - When the dispute was raised by the **counterparty** **and** the final
    outcome matches the original attested status, increments
    `counterparty_disputes_raised` on the counterparty's reputation.

- **Tests** (`test.rs`)
  - `test_counterparty_frivolous_dispute_increments_counter` — upheld
    dispute increments the counter.
  - `test_counterparty_justified_dispute_does_not_increment` — overturned
    dispute does not increment.
  - `test_issuer_raised_dispute_does_not_count_against_counterparty` —
    issuer-raised disputes never count against the counterparty.

## Why it matters

A counterparty can currently raise disputes on fairly-attested
commitments with no reputational downside, stalling finalization during
the dispute window. With this change, frivolous counterparty disputes are
recorded on-chain, giving other parties visibility into dispute behavior
before entering an agreement.

## Verification

- `cargo test -p registry --lib` — **all 68 tests pass**, including the 3
  new tests.
- Existing issuer-reputation tests pass **without modification**.
- Test snapshots regenerated to reflect the new struct fields.

> Note (Windows): the MSVC linker (`link.exe`) is not installed in this
> environment, so tests were run with the GNU toolchain:
> `cargo +stable-x86_64-pc-windows-gnu test -p registry --lib`.

## Trade-offs / decisions

- `disputed_from` is stored as the `CommitmentStatus` **discriminant**
  (`u32`) rather than an `Option<CommitmentStatus>`, because the
  Soroban `contracttype` derive does not support
  `Option<CustomEnum>` fields (it requires `T: Into<ScVal>`, which only
  native types satisfy). This mirrors the existing `attested_at:
  Option<u64>` pattern.
- Only **counterparty-raised** disputes increment the counter; issuer
  disputes and disputes the arbitrator rules in favor of the counterparty
  are not counted.