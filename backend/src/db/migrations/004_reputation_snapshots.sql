-- Daily per-address reputation snapshots backing GET /reputation/:address/history

CREATE TABLE IF NOT EXISTS reputation_snapshots (
    day DATE NOT NULL,
    address VARCHAR(255) NOT NULL,
    fulfilled INTEGER NOT NULL DEFAULT 0,
    late INTEGER NOT NULL DEFAULT 0,
    breached INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (address, day)
);

-- History is read newest-first for one address at a time.
CREATE INDEX IF NOT EXISTS idx_reputation_snapshots_address_day
    ON reputation_snapshots (address, day DESC);
