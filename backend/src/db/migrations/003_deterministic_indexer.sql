-- Canonical ledger snapshots used by the finality-aware indexer.

CREATE TABLE IF NOT EXISTS indexed_ledgers (
    sequence BIGINT PRIMARY KEY,
    ledger_hash TEXT NOT NULL,
    previous_hash TEXT,
    closed_at TIMESTAMPTZ NOT NULL,
    events JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_checkpoint (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    sequence BIGINT NOT NULL,
    ledger_hash TEXT NOT NULL
);
