-- TimescaleDB extension setup
-- This migration enables TimescaleDB extension for time-series data

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create hypertable for trust score snapshots
CREATE TABLE IF NOT EXISTS trust_score_snapshots (
    time TIMESTAMPTZ NOT NULL,
    address VARCHAR(255) NOT NULL,
    trust_score INTEGER NOT NULL,
    total_commitments INTEGER NOT NULL,
    fulfilled_commitments INTEGER NOT NULL,
    late_commitments INTEGER NOT NULL,
    breached_commitments INTEGER NOT NULL,
    fulfillment_rate DECIMAL(5,4) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Convert to hypertable with time as the time dimension
SELECT create_hypertable('trust_score_snapshots', 'time', if_not_exists => TRUE);

-- Create index on address for faster queries
CREATE INDEX IF NOT EXISTS idx_trust_score_snapshots_address ON trust_score_snapshots (address, time DESC);

-- Create hypertable for commitment outcomes
CREATE TABLE IF NOT EXISTS commitment_outcomes (
    time TIMESTAMPTZ NOT NULL,
    commitment_id VARCHAR(255) NOT NULL,
    party_a VARCHAR(255) NOT NULL,
    party_b VARCHAR(255),
    amount DECIMAL(20,8) NOT NULL,
    currency VARCHAR(10),
    status VARCHAR(50) NOT NULL,
    outcome VARCHAR(50) NOT NULL, -- 'fulfilled', 'late', 'breached', 'disputed'
    due_date TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Convert to hypertable with time as the time dimension
SELECT create_hypertable('commitment_outcomes', 'time', if_not_exists => TRUE);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_commitment_outcomes_party_a ON commitment_outcomes (party_a, time DESC);
CREATE INDEX IF NOT EXISTS idx_commitment_outcomes_party_b ON commitment_outcomes (party_b, time DESC);
CREATE INDEX IF NOT EXISTS idx_commitment_outcomes_outcome ON commitment_outcomes (outcome, time DESC);
CREATE INDEX IF NOT EXISTS idx_commitment_outcomes_status ON commitment_outcomes (status, time DESC);

-- Create hypertable for network-wide daily aggregates
CREATE TABLE IF NOT EXISTS network_daily_stats (
    time TIMESTAMPTZ NOT NULL,
    total_commitments INTEGER NOT NULL,
    total_fulfilled INTEGER NOT NULL,
    total_late INTEGER NOT NULL,
    total_breached INTEGER NOT NULL,
    total_disputed INTEGER NOT NULL,
    fulfillment_rate DECIMAL(5,4) NOT NULL,
    breach_rate DECIMAL(5,4) NOT NULL,
    unique_addresses INTEGER NOT NULL,
    total_volume DECIMAL(20,8) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Convert to hypertable
SELECT create_hypertable('network_daily_stats', 'time', if_not_exists => TRUE);

-- Create unique constraint to prevent duplicate daily stats
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_daily_stats_time ON network_daily_stats (time);
