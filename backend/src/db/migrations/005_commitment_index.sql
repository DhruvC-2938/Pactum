-- Migration 005: address → commitment reverse index
--
-- The registry contract only exposes get_commitment(id); there is no on-chain
-- way to list the commitments an address is party to. This table is the
-- backend's reverse index. It is populated from `commitment_created` events
-- (topics: symbol "created", issuer, counterparty; data: the u64 commitment id)
-- as the finality indexer commits ledgers, or rebuilt from indexed_ledgers by
-- backfillCommitmentIndex(). One row per commitment, keyed on the on-chain id so
-- re-indexing the same ledger is idempotent.

CREATE TABLE IF NOT EXISTS commitment_index (
    commitment_id   VARCHAR(255) PRIMARY KEY,
    issuer          VARCHAR(255) NOT NULL,
    counterparty    VARCHAR(255) NOT NULL,
    ledger_sequence BIGINT,
    created_at      TIMESTAMPTZ,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookups read "commitments for this address, newest first", so each party gets
-- its own index carrying the sort key. Postgres bitmap-ORs the two to serve the
-- `issuer = $1 OR counterparty = $1` query. The commitment_id tiebreaker makes
-- the ordering a strict total order, so LIMIT/OFFSET paging is stable.
CREATE INDEX IF NOT EXISTS idx_commitment_index_issuer
    ON commitment_index (issuer, ledger_sequence DESC, commitment_id DESC);
CREATE INDEX IF NOT EXISTS idx_commitment_index_counterparty
    ON commitment_index (counterparty, ledger_sequence DESC, commitment_id DESC);
