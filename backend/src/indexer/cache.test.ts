import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressesInLedger, invalidateLedger, isCacheAvailable, reputationKey } from './cache';
import { LedgerSnapshot } from './types';

const ISSUER = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR';
const COUNTERPARTY = 'GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U';

async function createdEventTopics(...addresses: string[]): Promise<string[]> {
  const { nativeToScVal } = await import('@stellar/stellar-sdk');
  return [
    nativeToScVal('created', { type: 'symbol' }).toXDR('base64'),
    ...addresses.map((address) => nativeToScVal(address, { type: 'address' }).toXDR('base64')),
  ];
}

function ledgerWithEvents(events: LedgerSnapshot['events']): LedgerSnapshot {
  return {
    sequence: 1,
    hash: 'ledger-1',
    previousHash: null,
    closedAt: new Date(1000).toISOString(),
    events,
  };
}

test('extracts every address carried by an indexed ledger event', async () => {
  const ledger = ledgerWithEvents([
    {
      id: 'event-1',
      type: 'contract',
      payload: { topic: await createdEventTopics(ISSUER, COUNTERPARTY) },
    },
  ]);

  assert.deepEqual((await addressesInLedger(ledger)).sort(), [ISSUER, COUNTERPARTY].sort());
});

test('deduplicates an address that appears in several events', async () => {
  const topics = await createdEventTopics(ISSUER);
  const ledger = ledgerWithEvents([
    { id: 'event-1', type: 'contract', payload: { topic: topics } },
    { id: 'event-2', type: 'contract', payload: { topic: topics } },
  ]);

  assert.deepEqual(await addressesInLedger(ledger), [ISSUER]);
});

test('ignores events whose topics are not decodable ScVals', async () => {
  const ledger = ledgerWithEvents([
    { id: 'event-1', type: 'contract', payload: { topic: ['not-base64-xdr'] } },
    { id: 'event-2', type: 'contract', payload: null },
    { id: 'event-3', type: 'contract', payload: { topic: 'not-an-array' } },
  ]);

  assert.deepEqual(await addressesInLedger(ledger), []);
});

test('invalidating a ledger is a no-op while Redis is unavailable', async () => {
  assert.equal(isCacheAvailable(), false);
  await invalidateLedger(
    ledgerWithEvents([
      {
        id: 'event-1',
        type: 'contract',
        payload: { topic: await createdEventTopics(ISSUER) },
      },
    ]),
  );
});

test('namespaces cache keys per address', () => {
  assert.equal(reputationKey(ISSUER), `reputation:${ISSUER}`);
  assert.notEqual(reputationKey(ISSUER), reputationKey(COUNTERPARTY));
});
