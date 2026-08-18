import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affectedReputationAddresses } from './reputation-projector';

test('extracts and deduplicates affected addresses from a finalized event payload', () => {
  const address = `G${'B'.repeat(55)}`;
  assert.deepEqual(affectedReputationAddresses({
    sequence: 1, hash: 'hash', previousHash: null, closedAt: new Date(0).toISOString(),
    events: [{ id: '1', type: 'contract', payload: { issuer: address, nested: [address] } }],
  }), [address]);
});
