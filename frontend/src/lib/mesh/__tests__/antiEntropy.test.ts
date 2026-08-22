import { describe, it, expect } from 'vitest';
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
    expect(resp.events.length).toBe(2);
    expect(resp.events[0].id).toBe('e1');
    expect(resp.events[1].id).toBe('e2');

    // Test invalid range bounds
    const invalidReq: AntiEntropyReqMessage = {
      type: 'ANTI_ENTROPY_REQ',
      fromLedger: 200,
      toLedger: 100, // from > to
      senderId: 'node-sync-2',
      timestamp: Date.now(),
    };
    const invalidResp = manager.handleSyncRequest(invalidReq);
    expect(invalidResp.events.length).toBe(0);

    // Test maxEventsPerSync cap
    const smallCapManager = new AntiEntropyManager(mockTransport, { maxEventsPerSync: 1 });
    smallCapManager.recordEvent(event1);
    smallCapManager.recordEvent(event2);
    const cappedResp = smallCapManager.handleSyncRequest(req);
    expect(cappedResp.events.length).toBe(1);

    manager.destroy();
    smallCapManager.destroy();
  });
});
