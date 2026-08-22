import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AntiEntropyManager } from '../antiEntropy.ts';
import type { SorobanIndexedEvent, AntiEntropyReqMessage } from '../types.ts';

describe('AntiEntropyManager', () => {
  it('correctly indexes and serves range queries for partition healing', () => {
    const mockTransport = {
      localPeerId: 'node-sync-1',
      sendToPeer: () => {},
      getActivePeers: () => [],
    } as any;

    const manager = new AntiEntropyManager(mockTransport, { maxEventsPerSync: 50 });

    const event1: SorobanIndexedEvent = {
      id: 'e1',
      contractId: 'C1',
      topic: 'test',
      xdrPayload: btoa('test'),
      ledgerSeq: 100,
      txHash: '0x1',
      timestamp: Date.now(),
      originPeerId: 'origin-1',
    };

    const event2: SorobanIndexedEvent = {
      id: 'e2',
      contractId: 'C1',
      topic: 'test',
      xdrPayload: btoa('test'),
      ledgerSeq: 102,
      txHash: '0x2',
      timestamp: Date.now(),
      originPeerId: 'origin-1',
    };

    manager.recordEvent(event1);
    manager.recordEvent(event2);

    const req: AntiEntropyReqMessage = {
      type: 'ANTI_ENTROPY_REQ',
      fromLedger: 99,
      toLedger: 105,
      senderId: 'node-sync-2',
      timestamp: Date.now(),
    };

    const resp = manager.handleSyncRequest(req);
    assert.equal(resp.events.length, 2);
    assert.equal(resp.events[0].id, 'e1');
    assert.equal(resp.events[1].id, 'e2');

    // Test invalid range bounds
    const invalidReq: AntiEntropyReqMessage = {
      type: 'ANTI_ENTROPY_REQ',
      fromLedger: 200,
      toLedger: 100, // from > to
      senderId: 'node-sync-2',
      timestamp: Date.now(),
    };
    const invalidResp = manager.handleSyncRequest(invalidReq);
    assert.equal(invalidResp.events.length, 0);

    // Test maxEventsPerSync cap
    const smallCapManager = new AntiEntropyManager(mockTransport, { maxEventsPerSync: 1 });
    smallCapManager.recordEvent(event1);
    smallCapManager.recordEvent(event2);
    const cappedResp = smallCapManager.handleSyncRequest(req);
    assert.equal(cappedResp.events.length, 1);

    manager.destroy();
    smallCapManager.destroy();
  });
});
