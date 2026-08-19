import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { Pool } from 'pg';
import {
  CommitmentCreated,
  InMemoryCommitmentIndex,
  MAX_LIMIT,
  PostgresCommitmentIndex,
  indexCommitmentsFromLedger,
  parseCommitmentCreatedEvents,
} from './commitments';
import { LedgerSnapshot } from './types';

// The SDK ships as an ES module while these tests compile to CommonJS, so it is
// imported lazily (mirrors cache.ts/cache.test.ts).
const sdk = () => import('@stellar/stellar-sdk');

// Deterministic, checksum-valid G-addresses. nativeToScVal({type:'address'})
// validates the strkey, so fabricated "G…" strings would be rejected; encoding a
// raw 32-byte seed yields a genuinely valid distinct address per fill byte.
async function address(fill: number): Promise<string> {
  const { StrKey } = await sdk();
  return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, fill));
}

// Builds a `commitment_created` event exactly as the indexer records it: topics
// (symbol "created", issuer, counterparty) and the u64 id as the value, each a
// base64 ScVal (see contracts/registry/src/events.rs).
async function createdEvent(
  id: number,
  issuer: string,
  counterparty: string,
): Promise<LedgerSnapshot['events'][number]> {
  const { nativeToScVal } = await sdk();
  return {
    id: `event-${id}`,
    type: 'contract',
    payload: {
      topic: [
        nativeToScVal('created', { type: 'symbol' }).toXDR('base64'),
        nativeToScVal(issuer, { type: 'address' }).toXDR('base64'),
        nativeToScVal(counterparty, { type: 'address' }).toXDR('base64'),
      ],
      value: nativeToScVal(id, { type: 'u64' }).toXDR('base64'),
    },
  };
}

function ledger(sequence: number, events: LedgerSnapshot['events']): LedgerSnapshot {
  return {
    sequence,
    hash: `ledger-${sequence}`,
    previousHash: sequence > 1 ? `ledger-${sequence - 1}` : null,
    closedAt: new Date(sequence * 1000).toISOString(),
    events,
  };
}

const entry = (
  commitmentId: string,
  issuer: string,
  counterparty: string,
  ledgerSequence: number,
): CommitmentCreated => ({
  commitmentId,
  issuer,
  counterparty,
  ledgerSequence,
  createdAt: new Date(ledgerSequence * 1000).toISOString(),
});

// ─── Event decoding ───────────────────────────────────────────────────────────

test('parseCommitmentCreatedEvents decodes issuer, counterparty and id', async () => {
  const issuer = await address(1);
  const counterparty = await address(2);

  const created = await parseCommitmentCreatedEvents(
    ledger(7, [await createdEvent(42, issuer, counterparty)]),
  );

  assert.deepEqual(created, [
    {
      commitmentId: '42',
      issuer,
      counterparty,
      ledgerSequence: 7,
      createdAt: new Date(7000).toISOString(),
    },
  ]);
});

test('parseCommitmentCreatedEvents skips non-created and malformed events', async () => {
  const { nativeToScVal } = await sdk();
  const issuer = await address(1);
  const counterparty = await address(2);

  const created = await parseCommitmentCreatedEvents(
    ledger(1, [
      // A different event type — topic[0] is not "created".
      {
        id: 'attested',
        type: 'contract',
        payload: {
          topic: [nativeToScVal('attested', { type: 'symbol' }).toXDR('base64')],
          value: nativeToScVal(1, { type: 'u64' }).toXDR('base64'),
        },
      },
      // "created" but missing the counterparty topic.
      {
        id: 'short',
        type: 'contract',
        payload: { topic: [nativeToScVal('created', { type: 'symbol' }).toXDR('base64')] },
      },
      // Topics that are not decodable ScVals.
      { id: 'garbage', type: 'contract', payload: { topic: ['not-xdr', 'x', 'y'] } },
      // No payload at all.
      { id: 'empty', type: 'contract', payload: null },
      // The one well-formed event.
      await createdEvent(5, issuer, counterparty),
    ]),
  );

  assert.deepEqual(
    created.map((c) => c.commitmentId),
    ['5'],
  );
});

// ─── In-memory reverse index ────────────────────────────────────────────────

test('finds commitments where the address is either the issuer or counterparty', async () => {
  const [a, b, c] = await Promise.all([address(1), address(2), address(3)]);
  const index = new InMemoryCommitmentIndex();

  await indexCommitmentsFromLedger(ledger(1, [await createdEvent(1, a, b)]), index); // a issues
  await indexCommitmentsFromLedger(ledger(2, [await createdEvent(2, c, a)]), index); // a is counterparty
  await indexCommitmentsFromLedger(ledger(3, [await createdEvent(3, b, c)]), index); // a absent

  const forA = await index.findByAddress(a);
  // Newest-first by ledger sequence.
  assert.deepEqual(
    forA.items.map((x) => x.commitmentId),
    ['2', '1'],
  );
  assert.equal(forA.total, 2);

  const forC = await index.findByAddress(c);
  assert.deepEqual(
    forC.items.map((x) => x.commitmentId),
    ['3', '2'],
  );
});

test('records a self-commitment once, with both parties equal', async () => {
  const a = await address(1);
  const index = new InMemoryCommitmentIndex();

  await indexCommitmentsFromLedger(ledger(1, [await createdEvent(1, a, a)]), index);

  const forA = await index.findByAddress(a);
  assert.equal(forA.total, 1);
  assert.equal(forA.items[0].issuer, a);
  assert.equal(forA.items[0].counterparty, a);
});

test('paginates newest-first and clamps out-of-range limit/offset', async () => {
  const [a, b] = await Promise.all([address(1), address(2)]);
  const index = new InMemoryCommitmentIndex();
  for (let i = 1; i <= 5; i += 1) {
    await indexCommitmentsFromLedger(ledger(i, [await createdEvent(i, a, b)]), index);
  }

  const page1 = await index.findByAddress(a, { limit: 2, offset: 0 });
  assert.deepEqual(
    page1.items.map((x) => x.commitmentId),
    ['5', '4'],
  );
  assert.equal(page1.total, 5);
  assert.equal(page1.limit, 2);
  assert.equal(page1.offset, 0);

  const page2 = await index.findByAddress(a, { limit: 2, offset: 2 });
  assert.deepEqual(
    page2.items.map((x) => x.commitmentId),
    ['3', '2'],
  );

  // limit above MAX_LIMIT and a negative offset are clamped to the valid range.
  const clamped = await index.findByAddress(a, { limit: 9999, offset: -5 });
  assert.equal(clamped.limit, MAX_LIMIT);
  assert.equal(clamped.offset, 0);
  assert.equal(clamped.items.length, 5);
});

test('re-indexing the same commitment id upserts rather than duplicating', async () => {
  const [a, b] = await Promise.all([address(1), address(2)]);
  const index = new InMemoryCommitmentIndex();

  await indexCommitmentsFromLedger(ledger(1, [await createdEvent(1, a, b)]), index);
  await indexCommitmentsFromLedger(ledger(1, [await createdEvent(1, a, b)]), index);

  assert.equal((await index.findByAddress(a)).total, 1);
});

// ─── PostgreSQL reverse index (integration) ─────────────────────────────────

test(
  'indexes and queries commitments in PostgreSQL',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = `commitment_index_test_${process.pid}_${Date.now()}`;

    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
      const migration = await readFile(
        path.join(process.cwd(), 'src/db/migrations/005_commitment_index.sql'),
        'utf8',
      );
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schema}"`);
        await client.query(migration);
      } finally {
        client.release();
      }

      const [a, b, c, stranger] = await Promise.all([
        address(1),
        address(2),
        address(3),
        address(9),
      ]);
      const index = new PostgresCommitmentIndex(pool, { schema });

      await index.indexCreated([
        entry('1', a, b, 1),
        entry('2', c, a, 2),
        entry('3', b, c, 3),
      ]);
      // Overlapping re-index (as a backfill would) rewrites rather than errors.
      await index.indexCreated([entry('1', a, b, 1)]);

      const forA = await index.findByAddress(a);
      assert.deepEqual(
        forA.items.map((x) => x.commitmentId),
        ['2', '1'],
      );
      assert.equal(forA.total, 2);
      assert.equal(forA.items[0].ledgerSequence, 2);
      assert.equal(forA.items[0].createdAt, new Date(2000).toISOString());

      const paged = await index.findByAddress(a, { limit: 1, offset: 1 });
      assert.deepEqual(
        paged.items.map((x) => x.commitmentId),
        ['1'],
      );
      assert.equal(paged.total, 2, 'total reflects all matches, not just the page');

      const none = await index.findByAddress(stranger);
      assert.equal(none.total, 0);
      assert.deepEqual(none.items, []);
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
