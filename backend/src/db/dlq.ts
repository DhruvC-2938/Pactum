import { Pool } from 'pg';

export interface DLQEntry {
  id?: string | number;
  url: string;
  payload: Record<string, any>;
  attempts: number;
  lastError: string;
  failedAt?: Date;
}

// In-memory fallback array for testing/environments without active PostgreSQL connection
const inMemoryDLQStore: DLQEntry[] = [];

let poolInstance: Pool | null = null;

function getPool(): Pool | null {
  if (process.env.DATABASE_URL && !poolInstance) {
    poolInstance = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return poolInstance;
}

/**
 * Initialize the webhook_dlq table in PostgreSQL if connected.
 */
export async function initializeDLQTable(): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  const query = `
    CREATE TABLE IF NOT EXISTS webhook_dlq (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      payload JSONB NOT NULL,
      attempts INT NOT NULL DEFAULT 5,
      last_error TEXT,
      failed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(query);
  } catch (error) {
    console.warn('[DLQ] Warning: Failed to execute CREATE TABLE IF NOT EXISTS for webhook_dlq:', error);
  }
}

/**
 * Persists a failed webhook delivery payload into the DLQ table in PostgreSQL (or in-memory store if DB is absent).
 */
export async function saveToDLQ(entry: DLQEntry): Promise<DLQEntry> {
  const record: DLQEntry = {
    ...entry,
    id: entry.id || `dlq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    failedAt: entry.failedAt || new Date()
  };

  // Always retain in fallback store for inspection and testing convenience
  inMemoryDLQStore.push(record);

  const pool = getPool();
  if (pool) {
    const query = `
      INSERT INTO webhook_dlq (url, payload, attempts, last_error, failed_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, url, payload, attempts, last_error AS "lastError", failed_at AS "failedAt";
    `;
    try {
      const res = await pool.query(query, [
        record.url,
        JSON.stringify(record.payload),
        record.attempts,
        record.lastError,
        record.failedAt
      ]);
      if (res.rows[0]) {
        return {
          ...res.rows[0],
          payload: typeof res.rows[0].payload === 'string' ? JSON.parse(res.rows[0].payload) : res.rows[0].payload
        };
      }
    } catch (error) {
      console.error('[DLQ] Error inserting record into PostgreSQL webhook_dlq table:', error);
    }
  }

  return record;
}

/**
 * Retrieve all DLQ entries.
 */
export async function getDLQEntries(): Promise<DLQEntry[]> {
  const pool = getPool();
  if (pool) {
    try {
      const res = await pool.query('SELECT id, url, payload, attempts, last_error AS "lastError", failed_at AS "failedAt" FROM webhook_dlq ORDER BY failed_at DESC');
      return res.rows.map(row => ({
        ...row,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
      }));
    } catch (error) {
      console.warn('[DLQ] Error querying PostgreSQL webhook_dlq table, returning in-memory store:', error);
    }
  }
  return [...inMemoryDLQStore];
}

/**
 * Clear DLQ records (useful for test resets).
 */
export async function clearDLQ(): Promise<void> {
  inMemoryDLQStore.length = 0;
  const pool = getPool();
  if (pool) {
    try {
      await pool.query('DELETE FROM webhook_dlq');
    } catch (error) {
      // Ignore DB errors during cleanup
    }
  }
}
