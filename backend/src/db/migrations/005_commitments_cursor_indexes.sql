-- Migration: 005_commitments_cursor_indexes.sql
-- Composite indexes for high-performance cursor-based (keyset) pagination and dynamic filtering

CREATE INDEX IF NOT EXISTS idx_commitments_cursor_keyset
ON commitment_outcomes (party_a, party_b, status, time DESC, commitment_id DESC);

CREATE INDEX IF NOT EXISTS idx_commitments_time_id_desc
ON commitment_outcomes (time DESC, commitment_id DESC);
