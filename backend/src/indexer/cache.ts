import { createClient } from 'redis';
import { LedgerSnapshot } from './types';

type RedisClient = ReturnType<typeof createClient>;

const DEFAULT_TTL_SECONDS = 60;

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

let client: RedisClient | null = null;
let available = false;

const connectTimeoutMs = (): number => Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 2000);

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
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
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
  ttlSeconds = Number(process.env.REPUTATION_CACHE_TTL_SECONDS || DEFAULT_TTL_SECONDS),
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
