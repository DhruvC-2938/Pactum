import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import {
  FinalityIndexer,
  LedgerLinkageError,
  NoCommonAncestorError,
} from './listener';
import { SorobanLedgerSource } from './rpc-source';
import { InMemoryIndexerStore, PostgresIndexerStore } from './store';
import { LedgerSnapshot, LedgerSource } from './types';

class SimulatedLedgerSource implements LedgerSource {
  private chain = new Map<number, LedgerSnapshot>();

  private latestSequence = 0;

  replaceChain(ledgers: LedgerSnapshot[]): void {
    this.chain = new Map(ledgers.map((ledger) => [ledger.sequence, ledger]));
    this.latestSequence = Math.max(...ledgers.map((ledger) => ledger.sequence));
  }

  async getLatestLedger(): Promise<{ sequence: number }> {
    return { sequence: this.latestSequence };
  }

  async getLedger(sequence: number): Promise<LedgerSnapshot | null> {
    return this.chain.get(sequence) ?? null;
  }
}

function makeChain(prefix: string, length: number, forkFrom?: LedgerSnapshot[]): LedgerSnapshot[] {
  const ledgers = forkFrom ? [...forkFrom] : [];
  for (let sequence = ledgers.length + 1; sequence <= length; sequence += 1) {
    const previousHash = sequence === 1 ? null : ledgers[sequence - 2].hash;
    ledgers.push({
      sequence,
      hash: `${prefix}-${sequence}`,
      previousHash,
      closedAt: new Date(sequence * 1000).toISOString(),
      events: [{ id: `${prefix}-event-${sequence}`, type: 'commitment', payload: { sequence } }],
    });
  }
  return ledgers;
}

test('keeps the newest ledgers out of the active store until finality depth is reached', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 6));
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({ source, store, finalityDepth: 2 });

  const result = await indexer.sync();

  assert.equal(result.finalizedSequence, 4);
  assert.equal(result.committed, 4);
  assert.deepEqual(await store.getCheckpoint(), { sequence: 4, hash: 'main-4' });
  assert.equal(await store.getLedger(5), null);
});

test('does not commit before the chain reaches the configured finality depth', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 2));
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({ source, store, finalityDepth: 2 });

  const result = await indexer.sync();

  assert.equal(result.finalizedSequence, 0);
  assert.equal(result.committed, 0);
  assert.equal(result.checkpoint, null);
});

test('limits each sync to the configured maximum batch size', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 8));
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({
    source,
    store,
    finalityDepth: 1,
    maxBatchSize: 3,
  });

  const result = await indexer.sync();

  assert.equal(result.committed, 3);
  assert.deepEqual(result.checkpoint, { sequence: 3, hash: 'main-3' });
  assert.equal(await store.getLedger(4), null);
});

test('rolls back to the last common ledger and replays the canonical fork', async () => {
  const source = new SimulatedLedgerSource();
  const mainChain = makeChain('main', 6);
  source.replaceChain(mainChain);
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({ source, store, finalityDepth: 1 });

  await indexer.sync();

  const fork = makeChain('fork', 6, mainChain.slice(0, 2));
  source.replaceChain(fork);
  const result = await indexer.sync();

  assert.equal(result.rolledBackFrom, 5);
  assert.equal(result.committed, 3);
  assert.equal((await store.getLedger(2))?.hash, 'main-2');
  assert.deepEqual(await store.getLedger(3), {
    sequence: 3,
    hash: 'fork-3',
    previousHash: 'main-2',
    closedAt: new Date(3000).toISOString(),
    events: [{ id: 'fork-event-3', type: 'commitment', payload: { sequence: 3 } }],
  });
  assert.deepEqual(await store.getCheckpoint(), { sequence: 5, hash: 'fork-5' });
});

test('recovers when a reorganization shortens the canonical chain', async () => {
  const source = new SimulatedLedgerSource();
  const mainChain = makeChain('main', 7);
  source.replaceChain(mainChain);
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({
    source,
    store,
    finalityDepth: 1,
    maxRollbackDepth: 5,
  });

  await indexer.sync();
  source.replaceChain(makeChain('fork', 5, mainChain.slice(0, 2)));

  const result = await indexer.sync();

  assert.equal(result.rolledBackFrom, 6);
  assert.equal(result.committed, 2);
  assert.deepEqual(result.checkpoint, { sequence: 4, hash: 'fork-4' });
  assert.equal(await store.getLedger(5), null);
  assert.equal(await store.getLedger(6), null);
});

test('preserves the checkpoint when RPC retention hides every ancestor', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 5));
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({ source, store, finalityDepth: 0 });
  await indexer.sync();

  const unavailableSource: LedgerSource = {
    async getLatestLedger() {
      return { sequence: 8 };
    },
    async getLedger() {
      return null;
    },
  };
  const unavailableIndexer = new FinalityIndexer({
    source: unavailableSource,
    store,
    finalityDepth: 0,
  });

  await assert.rejects(
    unavailableIndexer.sync(),
    (error: unknown) => error instanceof NoCommonAncestorError,
  );
  assert.deepEqual(await store.getCheckpoint(), { sequence: 5, hash: 'main-5' });
});

test(
  'rolls back and replays the canonical fork in PostgreSQL',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `indexer_test_${process.pid}_${Date.now()}`;

    try {
      const source = new SimulatedLedgerSource();
      const store = new PostgresIndexerStore(pool, { schema });
      await pool.query(`CREATE SCHEMA "${schema}"`);
      const migration = await readFile(
        path.join(process.cwd(), 'src/db/migrations/003_deterministic_indexer.sql'),
        'utf8',
      );
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schema}"`);
        await client.query(migration);
      } finally {
        client.release();
      }

      const mainChain = makeChain('main', 6);
      source.replaceChain(mainChain);
      const indexer = new FinalityIndexer({ source, store, finalityDepth: 1 });

      await indexer.sync();

      const fork = makeChain('fork', 6, mainChain.slice(0, 2));
      source.replaceChain(fork);
      const result = await indexer.sync();

      assert.equal(result.rolledBackFrom, 5);
      assert.equal(result.committed, 3);
      assert.deepEqual(await store.getLedger(3), {
        sequence: 3,
        hash: 'fork-3',
        previousHash: 'main-2',
        closedAt: new Date(3000).toISOString(),
        events: [{ id: 'fork-event-3', type: 'commitment', payload: { sequence: 3 } }],
      });
      assert.deepEqual(await store.getCheckpoint(), { sequence: 5, hash: 'fork-5' });

      const rows = await pool.query<{ sequence: string; ledger_hash: string }>(
        `SELECT sequence, ledger_hash
         FROM "${schema}"."indexed_ledgers"
         ORDER BY sequence`,
      );
      assert.deepEqual(
        rows.rows.map((row) => [Number(row.sequence), row.ledger_hash]),
        [
          [1, 'main-1'],
          [2, 'main-2'],
          [3, 'fork-3'],
          [4, 'fork-4'],
          [5, 'fork-5'],
        ],
      );
      assert.equal(await store.getLedger(6), null);

      const extendedFork = makeChain('fork', 8, mainChain.slice(0, 2));
      source.replaceChain(extendedFork);
      const competingIndexer = new FinalityIndexer({
        source,
        store: new PostgresIndexerStore(pool, { schema }),
        finalityDepth: 1,
      });
      await Promise.all([indexer.sync(), competingIndexer.sync()]);
      assert.deepEqual(await store.getCheckpoint(), {
        sequence: 7,
        hash: 'fork-7',
      });
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  },
);

test('rejects a canonical source that breaks the committed parent link', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 3));
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({ source, store, finalityDepth: 0 });

  await indexer.sync();
  source.replaceChain([
    ...makeChain('main', 1),
    {
      sequence: 2,
      hash: 'broken-2',
      previousHash: 'wrong-parent',
      closedAt: new Date(2000).toISOString(),
      events: [],
    },
    {
      sequence: 3,
      hash: 'broken-3',
      previousHash: 'broken-2',
      closedAt: new Date(3000).toISOString(),
      events: [],
    },
  ]);

  await assert.rejects(indexer.sync(), (error: unknown) => error instanceof LedgerLinkageError);
});

test('maps Soroban RPC ledger headers and events into the indexer model', async () => {
  const firstPageEvents = Array.from({ length: 100 }, (_, index) => ({
    id: `event-2-${index}`,
    type: 'contract',
    ledger: 2,
    value: { toXDR: () => `value-xdr-${index}` },
  }));
  const eventRequests: unknown[] = [];
  const source = new SorobanLedgerSource({
    async getLatestLedger() {
      return { sequence: 2 };
    },
    async getLedgers() {
      return {
        ledgers: [
          {
            sequence: 2,
            hash: 'ledger-2',
            ledgerCloseTime: '1786838402',
            headerXdr: {
              header: () => ({
                previousLedgerHash: () => Buffer.from('ledger-1'),
              }),
            },
          },
        ],
      };
    },
    async getEvents(request) {
      eventRequests.push(request);
      if ('startLedger' in request) {
        return { events: firstPageEvents, cursor: 'page-2' };
      }
      return {
        events: [{
          id: 'event-2-final',
          type: 'contract',
          ledger: 2,
          value: { toXDR: () => 'value-xdr-final' },
          ignored: undefined,
        }],
        cursor: 'page-2-final',
      };
    },
  });

  const ledger = await source.getLedger(2);
  assert.ok(ledger);
  assert.equal(ledger.events.length, 101);
  assert.deepEqual(ledger.events[ledger.events.length - 1], {
    id: 'event-2-final',
    type: 'contract',
    payload: {
      id: 'event-2-final',
      type: 'contract',
      ledger: 2,
      value: 'value-xdr-final',
    },
  });
  assert.deepEqual(eventRequests, [
    { filters: [], startLedger: 2, endLedger: 3, limit: 100 },
    { filters: [], cursor: 'page-2', limit: 100 },
  ]);
});

test('treats a ledger outside Soroban RPC retention as unavailable', async () => {
  const source = new SorobanLedgerSource({
    async getLatestLedger() {
      return { sequence: 200 };
    },
    async getLedgers() {
      throw Object.assign(
        new Error(
          'start ledger (1) must be between the oldest ledger: 100 and the latest ledger: 200 for this rpc instance',
        ),
        { code: -32600 },
      );
    },
    async getEvents() {
      throw new Error('getEvents should not be called');
    },
  });

  assert.equal(await source.getLedger(1), null);
});

test('reports every committed ledger to the commit hook', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 5));
  const store = new InMemoryIndexerStore();
  const committed: number[] = [];
  const indexer = new FinalityIndexer({
    source,
    store,
    finalityDepth: 2,
    onLedgerCommitted: (ledger) => {
      committed.push(ledger.sequence);
    },
  });

  await indexer.sync();

  assert.deepEqual(committed, [1, 2, 3]);
});

test('keeps indexing when the commit hook throws', async () => {
  const source = new SimulatedLedgerSource();
  source.replaceChain(makeChain('main', 4));
  const store = new InMemoryIndexerStore();
  const indexer = new FinalityIndexer({
    source,
    store,
    finalityDepth: 1,
    onLedgerCommitted: async () => {
      throw new Error('cache is down');
    },
  });

  const result = await indexer.sync();

  assert.equal(result.committed, 3);
  assert.deepEqual(await store.getCheckpoint(), { sequence: 3, hash: 'main-3' });
});
