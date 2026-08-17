import { createClient } from 'redis';
import { Pool } from 'pg';
import { LedgerSnapshot } from './types';

// ─── Redis reputation cache (upstream) ───────────────────────────────────────

type RedisClient = any;

const DEFAULT_TTL_SECONDS = 60;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

let client: RedisClient | null = null;
let available = false;

// A malformed override would otherwise reach Redis as NaN or a non-positive
// EX/timeout, which it rejects, silently turning every write into a miss.
const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const connectTimeoutMs = (): number => positiveInt(process.env.REDIS_CONNECT_TIMEOUT_MS, 2000);

export const cacheTtlSeconds = (): number =>
  positiveInt(process.env.REPUTATION_CACHE_TTL_SECONDS, DEFAULT_TTL_SECONDS);

const afterConnectTimeout = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, connectTimeoutMs()).unref();
  });

export const reputationKey = (address: string): string => `reputation:${address}`;

export const isCacheAvailable = (): boolean => available;

/**
 * Connects the shared Redis client. The cache is strictly an optimisation, so a
 * missing REDIS_URL or an unreachable server leaves it disabled rather than
 * failing startup; every helper below then no-ops and callers fall back to
 * PostgreSQL.
 */
export const initCache = async (): Promise<void> => {
  const url = process.env.REDIS_URL;
  if (!url) {
    console.log('[cache] REDIS_URL is not set, serving reputation from PostgreSQL only');
    return;
  }

  const redis = createClient({
    url,
    // Without this a disconnected client queues commands until it reconnects,
    // which would stall API requests instead of degrading to PostgreSQL.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: connectTimeoutMs(),
      reconnectStrategy: (retries: number) => Math.min(retries * 200, 5000),
    },
  });

  redis.on('error', (error: unknown) => {
    if (available) console.error('[cache] Redis connection error:', error);
    available = false;
  });
  redis.on('ready', () => {
    available = true;
    console.log('[cache] Redis connected');
  });
  redis.on('end', () => {
    available = false;
  });

  client = redis;

  const connecting = redis.connect().catch((error: unknown) => {
    console.error('[cache] Redis unavailable, serving reputation from PostgreSQL only:', error);
  });

  // The client retries a failed connection on its own schedule, so awaiting it
  // outright would hang startup while Redis is down. Give a healthy server a
  // moment to report ready, then start serving either way.
  await Promise.race([connecting, afterConnectTimeout()]);
};

export const closeCache = async (): Promise<void> => {
  if (!client) return;
  const redis = client;
  client = null;
  available = false;
  try {
    await redis.destroy();
  } catch {
    // Shutting down; the socket is going away either way.
  }
};

export const readCache = async <T>(key: string): Promise<T | null> => {
  if (!client || !available) return null;

  try {
    const cached = await client.get(key);
    return cached === null ? null : (JSON.parse(cached) as T);
  } catch (error) {
    console.error(`[cache] Read failed for ${key}:`, error);
    return null;
  }
};

export const writeCache = async (
  key: string,
  value: unknown,
  ttlSeconds = cacheTtlSeconds(),
): Promise<void> => {
  if (!client || !available) return;

  try {
    await client.set(key, JSON.stringify(value), { expiration: { type: 'EX', value: ttlSeconds } });
  } catch (error) {
    console.error(`[cache] Write failed for ${key}:`, error);
  }
};

export const invalidateReputation = async (addresses: Iterable<string>): Promise<void> => {
  if (!client || !available) return;

  const keys = [...new Set(addresses)].map(reputationKey);
  if (keys.length === 0) return;

  try {
    await client.del(keys);
  } catch (error) {
    console.error('[cache] Invalidation failed:', error);
  }
};

/**
 * Pulls every Stellar address out of a ledger's contract events. Topics and
 * values arrive as base64 ScVal XDR, so the SDK is imported lazily: it ships as
 * an ES module and the indexer is compiled to CommonJS.
 */
export const addressesInLedger = async (ledger: LedgerSnapshot): Promise<string[]> => {
  if (ledger.events.length === 0) return [];

  const { scValToNative, xdr } = await import('@stellar/stellar-sdk');
  const addresses = new Set<string>();

  const collect = (candidate: unknown): void => {
    if (typeof candidate !== 'string' || !STELLAR_ADDRESS.test(candidate)) return;
    addresses.add(candidate);
  };

  for (const event of ledger.events) {
    const payload = event.payload as { topic?: unknown; value?: unknown } | null;
    if (!payload || typeof payload !== 'object') continue;

    const encoded = [...(Array.isArray(payload.topic) ? payload.topic : []), payload.value];
    for (const entry of encoded) {
      if (typeof entry !== 'string') continue;
      try {
        collect(scValToNative(xdr.ScVal.fromXDR(entry, 'base64')));
      } catch {
        // Not an ScVal we can decode; nothing to invalidate from it.
      }
    }
  }

  return [...addresses];
};

/**
 * Drops the cached reputation of every address touched by a freshly indexed
 * ledger, so the next read rebuilds it from PostgreSQL.
 */
export const invalidateLedger = async (ledger: LedgerSnapshot): Promise<void> => {
  if (!client || !available) return;
  await invalidateReputation(await addressesInLedger(ledger));
};

// ─── Horizon SSE cursor cache ─────────────────────────────────────────────────

/**
 * Persisted cursor state for the Horizon SSE indexer.
 * The cursor is the Horizon paging_token of the last successfully processed event.
 * It is stored in PostgreSQL so the indexer can resume exactly where it left off
 * after a restart or stream disconnect, preventing duplicate processing.
 */
export interface CursorState {
  cursor: string;
  updatedAt: Date;
}

/**
 * In-memory cursor cache used in tests or when no database is available.
 */
export class InMemoryCursorCache {
  private cursor: string | null = null;

  async getCursor(): Promise<string | null> {
    return this.cursor;
  }

  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }

  async clear(): Promise<void> {
    this.cursor = null;
  }
}

/**
 * PostgreSQL-backed cursor cache that persists the latest Horizon SSE paging_token.
 *
 * Uses a single-row upsert keyed on `stream_name` so multiple independent SSE
 * streams (e.g. one per contract) can share the same table without collisions.
 *
 * On stream disconnect the cursor remains intact in the database, allowing the
 * indexer to reconnect and resume from the last successfully processed event.
 */
export class PostgresCursorCache {
  private readonly table: string;

  constructor(
    private readonly pool: Pool,
    private readonly streamName: string = 'horizon_sse',
    schema: string = 'public',
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid PostgreSQL schema identifier: ${schema}`);
    }
    this.table = `"${schema}"."indexer_cursors"`;
  }

  /**
   * Retrieves the persisted cursor for this stream, or null if none exists yet.
   * Returns null on a missing table so the indexer can start from the beginning.
   */
  async getCursor(): Promise<string | null> {
    try {
      const result = await this.pool.query<{ cursor: string }>(
        `SELECT cursor FROM ${this.table} WHERE stream_name = $1`,
        [this.streamName],
      );
      return result.rows[0]?.cursor ?? null;
    } catch (error: unknown) {
      // Table does not exist yet — treat as no cursor.
      if (
        error instanceof Error &&
        error.message.includes('does not exist')
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Persists the cursor atomically. Safe to call from concurrent indexer
   * instances — the last writer wins, which is correct because Horizon cursors
   * are monotonically increasing paging tokens.
   */
  async saveCursor(cursor: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (stream_name, cursor, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (stream_name) DO UPDATE
         SET cursor     = EXCLUDED.cursor,
             updated_at = EXCLUDED.updated_at`,
      [this.streamName, cursor],
    );
  }

  /**
   * Removes the persisted cursor for this stream.
   * Use when you want the indexer to replay from the beginning on next start.
   */
  async clear(): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE stream_name = $1`,
      [this.streamName],
    );
  }
}
