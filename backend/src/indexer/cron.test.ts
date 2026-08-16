import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previousDay, snapshotDay, SnapshotQuery, toDay } from './cron';

const BATCH_SIZE = Number(process.env.REPUTATION_SNAPSHOT_BATCH_SIZE || 500);

function recordingQuery(addresses: string[]): {
  query: SnapshotQuery;
  calls: { text: string; params: any[] }[];
} {
  const calls: { text: string; params: any[] }[] = [];
  const query: SnapshotQuery = async (text, params = []) => {
    calls.push({ text, params });
    return text.startsWith('SELECT DISTINCT')
      ? { rows: addresses.map((address) => ({ address })) }
      : { rows: [] };
  };
  return { query, calls };
}

test('formats a date as an ISO day', () => {
  assert.equal(toDay(new Date('2026-08-16T23:59:59.999Z')), '2026-08-16');
});

test('rolls the previous day back across month and year boundaries', () => {
  assert.equal(previousDay(new Date('2026-08-16T00:00:00Z')), '2026-08-15');
  assert.equal(previousDay(new Date('2026-03-01T00:00:00Z')), '2026-02-28');
  assert.equal(previousDay(new Date('2026-01-01T00:00:00Z')), '2025-12-31');
});

test('writes nothing when no address was active that day', async () => {
  const { query, calls } = recordingQuery([]);

  assert.equal(await snapshotDay('2026-08-15', query), 0);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /^SELECT DISTINCT/);
});

test('snapshots every active address in a single statement when they fit one batch', async () => {
  const addresses = Array.from({ length: 3 }, (_, i) => `G${i}`);
  const { query, calls } = recordingQuery(addresses);

  assert.equal(await snapshotDay('2026-08-15', query), 3);

  const inserts = calls.filter((call) => call.text.startsWith('INSERT INTO reputation_snapshots'));
  assert.equal(inserts.length, 1);
  assert.deepEqual(inserts[0].params, ['2026-08-15', addresses]);
});

test('splits a busy day into bounded batches rather than one huge statement', async () => {
  const addresses = Array.from({ length: BATCH_SIZE * 2 + 1 }, (_, i) => `G${i}`);
  const { query, calls } = recordingQuery(addresses);

  assert.equal(await snapshotDay('2026-08-15', query), addresses.length);

  const inserts = calls.filter((call) => call.text.startsWith('INSERT INTO reputation_snapshots'));
  assert.equal(inserts.length, 3);
  assert.deepEqual(
    inserts.map((call) => call.params[1].length),
    [BATCH_SIZE, BATCH_SIZE, 1],
  );
  assert.deepEqual(
    inserts.flatMap((call) => call.params[1]),
    addresses,
  );
});

test('carries the previous snapshot forward instead of rescanning all history', async () => {
  const { query, calls } = recordingQuery(['G0']);

  await snapshotDay('2026-08-15', query);

  const insert = calls.find((call) => call.text.startsWith('INSERT INTO reputation_snapshots'));
  assert.ok(insert);
  assert.match(insert.text, /LEFT JOIN LATERAL/);
  assert.match(insert.text, /day < \$1::date/);
  assert.match(insert.text, /ON CONFLICT \(address, day\) DO UPDATE/);
  assert.doesNotMatch(insert.text, /time <=? \$1::date - /);
});
