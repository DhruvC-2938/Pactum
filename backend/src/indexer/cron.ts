import { schedule, ScheduledTask } from 'node-cron';
import { queryTimescale } from '../db/timescale';

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
