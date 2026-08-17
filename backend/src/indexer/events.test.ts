import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseContractEvent, parseLedgerEvents } from './events';
import { LedgerEvent, LedgerSnapshot } from './types';

const ISSUER = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
const COUNTERPARTY = 'GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U';

type ScValType = 'symbol' | 'address' | 'u64' | 'u32';

async function encode(value: unknown, type: ScValType): Promise<string> {
  const { nativeToScVal } = await import('@stellar/stellar-sdk');
  return nativeToScVal(value, { type }).toXDR('base64');
}

function event(topics: string[], value?: string): LedgerEvent {
  return { id: 'event-1', type: 'contract', payload: { topic: topics, value } };
}

function ledgerWithEvents(events: LedgerEvent[]): LedgerSnapshot {
  return {
    sequence: 1,
    hash: 'ledger-1',
    previousHash: null,
    closedAt: new Date(1000).toISOString(),
    events,
  };
}

test('parses a created event into the issuing parties and commitment id', async () => {
  const parsed = await parseContractEvent(event(
    [
      await encode('created', 'symbol'),
      await encode(ISSUER, 'address'),
      await encode(COUNTERPARTY, 'address'),
    ],
    await encode(BigInt(42), 'u64'),
  ));

  assert.deepEqual(parsed, {
    type: 'created',
    commitmentId: '42',
    issuer: ISSUER,
    counterparty: COUNTERPARTY,
  });
});

test('parses an attested event into a final outcome', async () => {
  const parsed = await parseContractEvent(event(
    [
      await encode('attested', 'symbol'),
      await encode(BigInt(7), 'u64'),
    ],
    await encode(2, 'u32'),
  ));

  assert.deepEqual(parsed, { type: 'attested', commitmentId: '7', outcome: 'late' });
});

test('parses a disputed event without a payload value', async () => {
  const parsed = await parseContractEvent(event(
    [
      await encode('disputed', 'symbol'),
      await encode(BigInt(9), 'u64'),
    ],
  ));

  assert.deepEqual(parsed, { type: 'disputed', commitmentId: '9' });
});

test('parses a resolved event into its final outcome', async () => {
  const parsed = await parseContractEvent(event(
    [
      await encode('resolved', 'symbol'),
      await encode(BigInt(3), 'u64'),
    ],
    await encode(3, 'u32'),
  ));

  assert.deepEqual(parsed, { type: 'resolved', commitmentId: '3', outcome: 'breached' });
});

test('maps every commitment status discriminant to an outcome', async () => {
  const topics = [
    await encode('attested', 'symbol'),
    await encode(BigInt(1), 'u64'),
  ];
  const byStatus = await Promise.all([1, 2, 3].map(async (status) =>
    parseContractEvent(event(topics, await encode(status, 'u32'))),
  ));

  assert.deepEqual(byStatus.map((parsed) => (parsed as { outcome: string }).outcome), [
    'fulfilled',
    'late',
    'breached',
  ]);
});

test('ignores events from symbols other than the four contract events', async () => {
  const parsed = await parseContractEvent(event([await encode('upgraded', 'symbol')]));
  assert.equal(parsed, null);
});

test('ignores events whose topics are not decodable ScVals', async () => {
  assert.equal(await parseContractEvent(event(['not-base64-xdr'])), null);
  assert.equal(await parseContractEvent({ id: 'x', type: 'contract', payload: null }), null);
  assert.equal(
    await parseContractEvent({ id: 'x', type: 'contract', payload: { topic: 'not-an-array' } }),
    null,
  );
});

test('collects every parsed event across a ledger', async () => {
  const parsed = await parseLedgerEvents(ledgerWithEvents([
    event(
      [
        await encode('created', 'symbol'),
        await encode(ISSUER, 'address'),
        await encode(COUNTERPARTY, 'address'),
      ],
      await encode(BigInt(1), 'u64'),
    ),
    event(
      [
        await encode('attested', 'symbol'),
        await encode(BigInt(1), 'u64'),
      ],
      await encode(1, 'u32'),
    ),
    event([await encode('upgraded', 'symbol')]),
  ]));

  assert.deepEqual(parsed, [
    { type: 'created', commitmentId: '1', issuer: ISSUER, counterparty: COUNTERPARTY },
    { type: 'attested', commitmentId: '1', outcome: 'fulfilled' },
  ]);
});
