import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FinalityIndexer, LedgerLinkageError } from './listener';
import { SorobanLedgerSource } from './rpc-source';
import { InMemoryIndexerStore } from './store';
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

  async getLedger(sequence: number): Promise<LedgerSnapshot> {
    const ledger = this.chain.get(sequence);
    if (!ledger) throw new Error(`Missing simulated ledger ${sequence}`);
    return ledger;
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
            ledgerCloseTime: '2026-08-16T00:00:02.000Z',
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
      assert.deepEqual(request.filters, []);
      return {
        events: [{
          id: 'event-2',
          type: 'contract',
          ledger: 2,
          value: { toXDR: () => 'value-xdr' },
        }],
      };
    },
  });

  assert.deepEqual(await source.getLedger(2), {
    sequence: 2,
    hash: 'ledger-2',
    previousHash: Buffer.from('ledger-1').toString('hex'),
    closedAt: '2026-08-16T00:00:02.000Z',
    events: [{
      id: 'event-2',
      type: 'contract',
      payload: { id: 'event-2', type: 'contract', ledger: 2, value: 'value-xdr' },
    }],
  });
});
