import Redis, { Cluster, ClusterNode, Redis as RedisClient } from 'ioredis';
import { Reputation, ReputationRepository } from '../reputation/types';

export const TRUST_SCORE_KEY_PREFIX = 'trust_score:';

export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface ReputationCacheOptions {
  ttlSeconds?: number;
}

export class ReputationCache {
  private readonly ttlSeconds: number;
  private readonly pending = new Map<string, Promise<Reputation | null>>();

  constructor(
    private readonly redis: KeyValueCache,
    private readonly repository: ReputationRepository,
    options: ReputationCacheOptions = {},
  ) {
    this.ttlSeconds = options.ttlSeconds ?? 300;
  }

  static key(address: string): string {
    return `${TRUST_SCORE_KEY_PREFIX}${address}`;
  }

  async get(address: string): Promise<{ value: Reputation | null; hit: boolean }> {
    const key = ReputationCache.key(address);
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return { value: JSON.parse(cached) as Reputation, hit: true };
    } catch (error) {
      console.error('Redis reputation read failed; falling back to PostgreSQL', error);
    }

    let request = this.pending.get(address);
    if (!request) {
      request = this.loadAndPopulate(address).finally(() => this.pending.delete(address));
      this.pending.set(address, request);
    }
    return { value: await request, hit: false };
  }

  /** Refreshes the key from the source of truth immediately after finality. */
  async refresh(address: string): Promise<Reputation | null> {
    return this.loadAndPopulate(address);
  }

  async invalidate(address: string): Promise<void> {
    await this.redis.del(ReputationCache.key(address));
  }

  private async loadAndPopulate(address: string): Promise<Reputation | null> {
    const value = await this.repository.findByAddress(address);
    try {
      if (value) {
        await this.redis.setex(
          ReputationCache.key(address),
          this.ttlSeconds,
          JSON.stringify(value),
        );
      } else {
        await this.redis.del(ReputationCache.key(address));
      }
    } catch (error) {
      console.error('Redis reputation update failed', error);
    }
    return value;
  }
}

function clusterNodes(value: string): ClusterNode[] {
  return value.split(',').map((entry) => {
    const [host, port = '6379'] = entry.trim().split(':');
    return { host, port: Number(port) };
  });
}

export function createRedisClientFromEnv(): RedisClient | Cluster {
  const nodes = process.env.REDIS_CLUSTER_NODES;
  const common = {
    enableReadyCheck: true,
    maxRetriesPerRequest: 1,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 500),
    password: process.env.REDIS_PASSWORD || undefined,
  };
  if (nodes) {
    return new Redis.Cluster(clusterNodes(nodes), {
      redisOptions: common,
      scaleReads: 'slave',
      slotsRefreshTimeout: 1000,
    });
  }
  return new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', common);
}
