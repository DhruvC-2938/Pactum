import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { createCommitmentIndexingHook, FinalityIndexer } from '../../src/indexer/listener';
import { PostgresCommitmentIndex } from '../../src/indexer/commitments';
import { PostgresIndexerStore } from '../../src/indexer/store';
import { LedgerSnapshot, LedgerSource } from '../../src/indexer/types';
import { IntegrationDatabase, startIntegrationDatabase, stopIntegrationDatabase } from '../setup';

// The SDK ships as an ES module while the backend compiles to CommonJS, so it
// is imported lazily (mirrors src/indexer/commitments.test.ts).
const sdk = () => import('@stellar/stellar-sdk');

// Deterministic, checksum-valid G-addresses -- nativeToScVal({type:'address'})
// validates the strkey, so a fabricated "G..." string would be rejected.
async function address(fill: number): Promise<string> {
  const { StrKey } = await sdk();
  return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));
}

/**
 * Builds a `commitment_created` contract event exactly as the on-chain
 * registry emits it and the indexer decodes it: topics (symbol "created",
 * issuer, counterparty, oracle) and (id, schema_id) as the base64 XDR value.
 * See contracts/registry/src/events.rs and src/indexer/events.ts.
 */
async function commitmentCreatedEvent(
  id: number,
  issuer: string,
  counterparty: string,
): Promise<LedgerSnapshot['events'][number]> {
  const { nativeToScVal, xdr } = await sdk();
  return {
    id: `event-${id}`,
    type: 'contract',
    payload: {
      topic: [
        nativeToScVal('created', { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(issuer, { type: 'address' }).toXDR('base64'),
        nativeToScVal(counterparty, { type: 'address' }).toXDR('base64'),
        xdr.ScVal.scvVoid().toXDR('base64'), // oracle: Option<Address> = None
      ],
      value: xdr.ScVal.scvVec([nativeToScVal(id, { type: 'u64' }), xdr.ScVal.scvVoid()]).toXDR(
        'base64',
      ),
    },
  };
}

function ledgerOf(sequence: number, events: LedgerSnapshot['events']): LedgerSnapshot {
  return {
    sequence,
    hash: `ledger-${sequence}`,
    previousHash: sequence === 1 ? null : `ledger-${sequence - 1}`,
    closedAt: new Date(sequence * 1000).toISOString(),
    events,
  };
}

class FixedLedgerSource implements LedgerSource {
  constructor(private readonly ledgers: LedgerSnapshot[]) {}

  async getLatestLedger(): Promise<{ sequence: number }> {
    return { sequence: this.ledgers[this.ledgers.length - 1].sequence };
  }

  async getLedger(sequence: number): Promise<LedgerSnapshot | null> {
    return this.ledgers.find((ledger) => ledger.sequence === sequence) ?? null;
  }
}

describe('indexer integration: mock Soroban events -> FinalityIndexer -> PostgreSQL', () => {
  let db: IntegrationDatabase;
  let pool: Pool;

  before(async () => {
    db = await startIntegrationDatabase();
    pool = db.pool;
  });

  after(async () => {
    await stopIntegrationDatabase(db);
  });

  afterEach(async () => {
    await pool.query('TRUNCATE TABLE indexed_ledgers, indexer_checkpoint, commitment_index');
  });

  it('indexes a mock commitment_created Soroban event end-to-end into Postgres', async () => {
    const [issuer, counterparty] = await Promise.all([address(1), address(2)]);
    const event = await commitmentCreatedEvent(42, issuer, counterparty);
    const source = new FixedLedgerSource([ledgerOf(1, [event])]);

    const store = new PostgresIndexerStore(pool);
    const commitmentIndex = new PostgresCommitmentIndex(pool);
    const indexer = new FinalityIndexer({
      source,
      store,
      finalityDepth: 0,
      onLedgerCommitted: createCommitmentIndexingHook(commitmentIndex),
    });

    const result = await indexer.sync();

    assert.equal(result.committed, 1);
    assert.deepEqual(result.checkpoint, { sequence: 1, hash: 'ledger-1' });

    // Verified directly against the table, not just through the store
    // abstraction, so the assertion proves the row actually landed in Postgres.
    const ledgerRows = await pool.query(
      'SELECT sequence, ledger_hash FROM indexed_ledgers ORDER BY sequence',
    );
    assert.deepEqual(
      ledgerRows.rows.map((row) => [Number(row.sequence), row.ledger_hash]),
      [[1, 'ledger-1']],
    );

    const forIssuer = await commitmentIndex.findByAddress(issuer);
    assert.equal(forIssuer.total, 1);
    assert.equal(forIssuer.items[0].commitmentId, '42');
    assert.equal(forIssuer.items[0].issuer, issuer);
    assert.equal(forIssuer.items[0].counterparty, counterparty);
    assert.equal(forIssuer.items[0].ledgerSequence, 1);

    const forCounterparty = await commitmentIndex.findByAddress(counterparty);
    assert.equal(forCounterparty.total, 1);
    assert.equal(forCounterparty.items[0].commitmentId, '42');
  });

  it('indexes multiple ledgers of mock events and advances the checkpoint across them', async () => {
    const [a, b, c] = await Promise.all([address(3), address(4), address(5)]);
    const source = new FixedLedgerSource([
      ledgerOf(1, [await commitmentCreatedEvent(1, a, b)]),
      ledgerOf(2, [await commitmentCreatedEvent(2, b, c)]),
    ]);

    const store = new PostgresIndexerStore(pool);
    const commitmentIndex = new PostgresCommitmentIndex(pool);
    const indexer = new FinalityIndexer({
      source,
      store,
      finalityDepth: 0,
      onLedgerCommitted: createCommitmentIndexingHook(commitmentIndex),
    });

    const result = await indexer.sync();

    assert.equal(result.committed, 2);
    assert.deepEqual(await store.getCheckpoint(), { sequence: 2, hash: 'ledger-2' });

    // b is party to both commitments -- proves the reverse index accumulates
    // across ledgers rather than only keeping the latest one.
    const forB = await commitmentIndex.findByAddress(b);
    assert.equal(forB.total, 2);
    assert.deepEqual(forB.items.map((item) => item.commitmentId).sort(), ['1', '2']);
  });

  it('leaves the checkpoint and commitment index untouched when a ledger has no decodable commitment events', async () => {
    const source = new FixedLedgerSource([
      ledgerOf(1, [{ id: 'noise-1', type: 'contract', payload: { topic: [], value: null } }]),
    ]);

    const store = new PostgresIndexerStore(pool);
    const commitmentIndex = new PostgresCommitmentIndex(pool);
    const indexer = new FinalityIndexer({
      source,
      store,
      finalityDepth: 0,
      onLedgerCommitted: createCommitmentIndexingHook(commitmentIndex),
    });

    const result = await indexer.sync();

    // The ledger is still canonical and gets committed to indexed_ledgers /
    // the checkpoint -- only the derived commitment_index stays empty.
    assert.equal(result.committed, 1);
    assert.deepEqual(await store.getCheckpoint(), { sequence: 1, hash: 'ledger-1' });

    const rows = await pool.query('SELECT COUNT(*)::int AS count FROM commitment_index');
    assert.equal(rows.rows[0].count, 0);
  });
});
