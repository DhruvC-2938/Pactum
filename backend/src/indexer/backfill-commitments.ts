import pool from '../db/timescale';
import { PostgresCommitmentIndex, backfillCommitmentIndex } from './commitments';

// Standalone entrypoint: `node dist/indexer/backfill-commitments.js` rebuilds the
// address → commitment reverse index from the canonical ledgers already in
// indexed_ledgers. Idempotent, so it is safe to run at any time — including while
// the live indexing hook is running. Exits explicitly because the pg pool keeps
// the event loop alive (mirrors db/migrate.ts).
backfillCommitmentIndex(pool, new PostgresCommitmentIndex(pool))
  .then(async ({ ledgers, commitments }) => {
    console.log(`[backfill] Indexed ${commitments} commitment(s) from ${ledgers} ledger(s)`);
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[backfill] Failed:', error);
    try {
      await pool.end();
    } catch {
      // Surface the backfill failure, not the teardown failure.
    }
    process.exit(1);
  });
