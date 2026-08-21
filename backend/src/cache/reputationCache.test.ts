import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyValueCache, ReputationCache } from './reputationCache';
import { Reputation, ReputationRepository } from '../reputation/types';

class MemoryCache implements KeyValueCache {
  readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async setex(key: string, _seconds: number, value: string) {
    this.values.set(key, value);
    return 'OK';
  }
  async del(key: string) {
    return this.values.delete(key) ? 1 : 0;
  }
}

const address = `G${'A'.repeat(55)}`;
const reputation: Reputation = {
  address,
  trustScore: 90,
  totalCommitments: 5,
  fulfilledCommitments: 5,
  lateCommitments: 0,
  breachedCommitments: 0,
  fulfillmentRate: 1,
  updatedAt: '2026-08-16T00:00:00.000Z',
};

test('cache-aside populates a miss and serves subsequent reads from Redis', async () => {
  const redis = new MemoryCache();
  let reads = 0;
  const repository: ReputationRepository = {
    async findByAddress() {
      reads += 1;
      return reputation;
    },
  };
  const cache = new ReputationCache(redis, repository);

  assert.equal((await cache.get(address)).hit, false);
  assert.equal((await cache.get(address)).hit, true);
  assert.equal(reads, 1);
  assert.deepEqual(JSON.parse(redis.values.get(`trust_score:${address}`)!), reputation);
});

test('collapses concurrent misses to one PostgreSQL query', async () => {
  const redis = new MemoryCache();
  let reads = 0;
  const cache = new ReputationCache(redis, {
    async findByAddress() {
      reads += 1;
      await new Promise((r) => setTimeout(r, 5));
      return reputation;
    },
  });

  await Promise.all(Array.from({ length: 100 }, () => cache.get(address)));
  assert.equal(reads, 1);
});

test('refresh atomically replaces a stale finalized score', async () => {
  const redis = new MemoryCache();
  redis.values.set(`trust_score:${address}`, JSON.stringify({ ...reputation, trustScore: 10 }));
  const cache = new ReputationCache(redis, {
    async findByAddress() {
      return reputation;
    },
  });

  await cache.refresh(address);
  assert.equal((await cache.get(address)).value?.trustScore, 90);
});
