import { schedule, ScheduledTask } from 'node-cron';
import { queryTimescale } from '../db/timescale';
import {
  TtlMonitor,
  TtlBumper,
  TtlRpcClient,
  DEFAULT_TTL_REFRESH_THRESHOLD_LEDGERS,
  createTtlRpcClient,
} from './ttl-monitor';

const SNAPSHOT_CRON = process.env.REPUTATION_SNAPSHOT_CRON || '0 0 * * *';
const SNAPSHOT_TIMEZONE = process.env.REPUTATION_SNAPSHOT_TIMEZONE || 'UTC';
const SNAPSHOT_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.REPUTATION_SNAPSHOT_BATCH_SIZE || '500', 10),
);

/**
 * The subset of `queryTimescale` the snapshot needs, so the batching can be
 * exercised without a database.
 */
export type SnapshotQuery = (text: string, params?: any[]) => Promise<{ rows: any[] }>;

export const toDay = (date: Date): string => date.toISOString().slice(0, 10);

export const previousDay = (from: Date = new Date()): string => {
  const day = new Date(from);
  day.setUTCDate(day.getUTCDate() - 1);
  return toDay(day);
};

const activeAddresses = async (day: string, query: SnapshotQuery): Promise<string[]> => {
  const result = await query(
    `SELECT DISTINCT party_a AS address
       FROM commitment_outcomes
      WHERE time >= $1::date
        AND time < $1::date + INTERVAL '1 day'`,
    [day],
  );

  return result.rows.map((row) => row.address as string);
};

/**
 * Rolls one day of outcomes into each address's running totals. The previous
 * snapshot supplies the carried balance, so a night's work is proportional to
 * that day's activity rather than to the whole history.
 */
const snapshotBatch = async (
  day: string,
  addresses: string[],
  query: SnapshotQuery,
): Promise<void> => {
  await query(
    `INSERT INTO reputation_snapshots (day, address, fulfilled, late, breached, total)
     SELECT
       $1::date,
       daily.address,
       COALESCE(carried.fulfilled, 0) + daily.fulfilled,
       COALESCE(carried.late, 0) + daily.late,
       COALESCE(carried.breached, 0) + daily.breached,
       COALESCE(carried.total, 0) + daily.total
     FROM (
       SELECT
         party_a AS address,
         COUNT(*) FILTER (WHERE outcome = 'fulfilled')::int AS fulfilled,
         COUNT(*) FILTER (WHERE outcome = 'late')::int AS late,
         COUNT(*) FILTER (WHERE outcome = 'breached')::int AS breached,
         COUNT(*)::int AS total
       FROM commitment_outcomes
       WHERE time >= $1::date
         AND time < $1::date + INTERVAL '1 day'
         AND party_a = ANY($2::text[])
       GROUP BY party_a
     ) daily
     LEFT JOIN LATERAL (
       SELECT fulfilled, late, breached, total
       FROM reputation_snapshots
       WHERE address = daily.address
         AND day < $1::date
       ORDER BY day DESC
       LIMIT 1
     ) carried ON TRUE
     ON CONFLICT (address, day) DO UPDATE SET
       fulfilled = EXCLUDED.fulfilled,
       late = EXCLUDED.late,
       breached = EXCLUDED.breached,
       total = EXCLUDED.total`,
    [day, addresses],
  );
};

/**
 * Writes the reputation snapshot for `day`, in batches of addresses so a busy
 * day never turns into one unbounded statement. Returns how many addresses
 * were snapshotted. Safe to re-run for the same day.
 */
export const snapshotDay = async (
  day: string,
  query: SnapshotQuery = queryTimescale,
): Promise<number> => {
  const addresses = await activeAddresses(day, query);
  if (addresses.length === 0) return 0;

  for (let offset = 0; offset < addresses.length; offset += SNAPSHOT_BATCH_SIZE) {
    await snapshotBatch(day, addresses.slice(offset, offset + SNAPSHOT_BATCH_SIZE), query);
  }

  return addresses.length;
};

let running = false;

export const runDailySnapshot = async (day: string = previousDay()): Promise<void> => {
  if (running) {
    console.warn('[Snapshot Cron] Previous run is still in flight, skipping this tick');
    return;
  }

  running = true;
  const startedAt = Date.now();
  try {
    const addresses = await snapshotDay(day);
    console.log(
      `[Snapshot Cron] Snapshotted ${addresses} addresses for ${day} in ${Date.now() - startedAt}ms`,
    );
  } catch (error) {
    console.error(`[Snapshot Cron] Snapshot for ${day} failed:`, error);
  } finally {
    running = false;
  }
};

export const startSnapshotCron = (): ScheduledTask => {
  console.log(
    `[Snapshot Cron] Scheduling daily snapshots at "${SNAPSHOT_CRON}" (${SNAPSHOT_TIMEZONE})`,
  );
  return schedule(SNAPSHOT_CRON, () => runDailySnapshot(), {
    timezone: SNAPSHOT_TIMEZONE,
    noOverlap: true,
  });
};

// Run a single day on demand: `node dist/indexer/cron.js 2026-08-15`
if (require.main === module) {
  const day = process.argv[2] || previousDay();
  runDailySnapshot(day).then(() => process.exit(0));
}

// ─── TTL Monitor Cron ────────────────────────────────────────────────────────

/**
 * Cron schedule for the TTL monitor.
 * Default: every 6 hours.  Override with `TTL_MONITOR_CRON`.
 */
const TTL_MONITOR_CRON = process.env.TTL_MONITOR_CRON || '0 */6 * * *';

/**
 * Timezone for the TTL monitor cron.
 * Default: UTC.  Override with `TTL_MONITOR_TIMEZONE`.
 */
const TTL_MONITOR_TIMEZONE = process.env.TTL_MONITOR_TIMEZONE || 'UTC';

/**
 * TTL threshold in ledgers below which a rent-bump is submitted.
 * Default: 241_920 (≈14 days at 5s/ledger, matching the contract constant).
 * Override with `TTL_MONITOR_THRESHOLD_LEDGERS`.
 */
const TTL_MONITOR_THRESHOLD_LEDGERS = Math.max(
  1,
  parseInt(
    process.env.TTL_MONITOR_THRESHOLD_LEDGERS
      ?? String(DEFAULT_TTL_REFRESH_THRESHOLD_LEDGERS),
    10,
  ),
);

/**
 * Maximum number of concurrent bump transactions per run.
 * Override with `TTL_MONITOR_BUMP_CONCURRENCY`.
 */
const TTL_MONITOR_BUMP_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.TTL_MONITOR_BUMP_CONCURRENCY || '5', 10),
);

let ttlMonitorRunning = false;

/**
 * Runs one TTL-monitor scan: fetches the set of high-value addresses from
 * TimescaleDB, checks each address's Soroban entry TTL, and submits a
 * `bumpReputationTtl` transaction for every address that is near expiry.
 *
 * @param rpc  - Soroban RPC client adapter (TtlRpcClient).
 * @param bumper - Soroban client that can submit TTL-bump transactions.
 * @param query - Optional SnapshotQuery override (for testing).
 */
export const runTtlMonitor = async (
  rpc: TtlRpcClient,
  bumper: TtlBumper,
  query: SnapshotQuery = queryTimescale,
  contractId: string = process.env.SOROBAN_CONTRACT_ID ?? '',
): Promise<void> => {
  if (ttlMonitorRunning) {
    console.warn('[TTL Monitor] Previous run is still in flight, skipping this tick');
    return;
  }

  ttlMonitorRunning = true;
  const startedAt = Date.now();

  try {
    // Fetch the union of all addresses that have ever appeared in commitment
    // outcomes — these are the addresses with on-chain reputation data.
    const addressResult = await query(
      `SELECT DISTINCT party_a AS address FROM commitment_outcomes`,
    );
    const highValueAddresses = addressResult.rows.map((row) => row.address as string);

    const monitor = new TtlMonitor({
      rpc,
      bumper,
      getHighValueAddresses: async () => highValueAddresses,
      ttlRefreshThresholdLedgers: TTL_MONITOR_THRESHOLD_LEDGERS,
      bumpConcurrency: TTL_MONITOR_BUMP_CONCURRENCY,
      contractId,
    });

    const result = await monitor.run();

    console.log(
      `[TTL Monitor] Scanned ${result.total} addresses in ${Date.now() - startedAt}ms ` +
      `| near-expiry: ${result.nearExpiry} | bumped: ${result.bumped} | failed: ${result.failed}`,
    );

    if (result.failed > 0) {
      for (const [address, error] of Object.entries(result.errors)) {
        console.error(`[TTL Monitor] Failed to bump ${address}: ${error}`);
      }
    }
  } catch (error) {
    console.error('[TTL Monitor] Run failed:', error);
  } finally {
    ttlMonitorRunning = false;
  }
};

/**
 * Starts the TTL monitor cron job.
 *
 * The job runs on `TTL_MONITOR_CRON` schedule (default every 6 hours) and
 * calls `runTtlMonitor` with the supplied Soroban RPC and bumper instances.
 *
 * @param rpc    - Soroban RPC adapter (use `createTtlRpcClient` with a live `rpc.Server`).
 * @param bumper - Soroban client with `bumpReputationTtl` (use `SorobanClient`).
 * @returns The scheduled task (call `.stop()` to cancel).
 */
export const startTtlMonitorCron = (
  rpc: TtlRpcClient,
  bumper: TtlBumper,
): ScheduledTask => {
  console.log(
    `[TTL Monitor] Scheduling TTL monitor at "${TTL_MONITOR_CRON}" (${TTL_MONITOR_TIMEZONE}) ` +
    `| threshold: ${TTL_MONITOR_THRESHOLD_LEDGERS} ledgers | concurrency: ${TTL_MONITOR_BUMP_CONCURRENCY}`,
  );
  return schedule(
    TTL_MONITOR_CRON,
    () => void runTtlMonitor(rpc, bumper),
    {
      timezone: TTL_MONITOR_TIMEZONE,
      noOverlap: true,
    },
  );
};

export { createTtlRpcClient };
