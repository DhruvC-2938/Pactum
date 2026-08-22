import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PlumtreeEngine } from '../plumtreeEngine.ts';
import { PeerScoringManager } from '../peerScoring.ts';
import type { MeshProtocolMessage, SorobanIndexedEvent, GossipDataMessage } from '../types.ts';

describe('PlumtreeEngine', () => {
  function createEngine(localPeerId: string) {
    const sentMessages: { targetPeerId: string; message: MeshProtocolMessage }[] = [];
    const deliveredEvents: { event: SorobanIndexedEvent; senderId: string }[] = [];

    const scoring = new PeerScoringManager();
    const engine = new PlumtreeEngine(
      { localPeerId, targetEagerFanout: 2, minEagerFanout: 1, maxEagerFanout: 4 },
      scoring,
      (targetPeerId, message) => sentMessages.push({ targetPeerId, message }),
      (event, senderId) => deliveredEvents.push({ event, senderId })
    );

    return { engine, scoring, sentMessages, deliveredEvents };
  }

  function createMockEvent(id: string = 'msg-1'): SorobanIndexedEvent {
    return {
      id,
      contractId: 'CA3D...PACTUM',
      topic: 'contract_invoked',
      xdrPayload: btoa('test-payload'),
      ledgerSeq: 104520,
      txHash: '0xdeadbeef',
      timestamp: Date.now(),
      originPeerId: 'peer-alice',
    };
  }

  it('adds peers to eager and lazy overlays according to target fanout', () => {
    const { engine } = createEngine('node-a');

    engine.addPeer('node-b');
    engine.addPeer('node-c');
    engine.addPeer('node-d'); // exceeds targetEagerFanout of 2 -> added to lazy

    assert.deepEqual(engine.getEagerNeighbors(), ['node-b', 'node-c']);
    assert.deepEqual(engine.getLazyNeighbors(), ['node-d']);

    engine.destroy();
  });

  it('eagerly propagates novel messages to eager neighbors and delivers locally', () => {
    const { engine, sentMessages, deliveredEvents } = createEngine('node-a');
    engine.addPeer('node-b');
    engine.addPeer('node-c');

    const event = createMockEvent('msg-unique-1');
    const msg: GossipDataMessage = {
      type: 'GOSSIP_DATA',
      messageId: event.id,
      topic: event.topic,
      event,
      hopCount: 0,
      senderId: 'node-b',
      timestamp: Date.now(),
    };

    engine.handleMessage('node-b', msg);

    assert.equal(deliveredEvents.length, 1);
    assert.equal(deliveredEvents[0].event.id, 'msg-unique-1');

    // Should forward to node-c (other eager peer)
    const forwarded = sentMessages.filter((s) => s.targetPeerId === 'node-c');
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].message.type, 'GOSSIP_DATA');

    engine.destroy();
  });

  it('prunes eager peer upon receiving duplicate message', () => {
    const { engine, sentMessages } = createEngine('node-a');
    engine.addPeer('node-b');

    const event = createMockEvent('msg-dup-1');
    const msg: GossipDataMessage = {
      type: 'GOSSIP_DATA',
      messageId: event.id,
      topic: event.topic,
      event,
      hopCount: 0,
      senderId: 'node-b',
      timestamp: Date.now(),
    };

    // First arrival (novel)
    engine.handleMessage('node-b', msg);

    // Second arrival (duplicate)
    engine.handleMessage('node-b', msg);

    assert.equal(engine.duplicatesPrunedCount, 1);
    const pruneMsgs = sentMessages.filter((s) => s.targetPeerId === 'node-b' && s.message.type === 'PRUNE');
    assert.equal(pruneMsgs.length, 1);
    assert.ok(engine.getLazyNeighbors().includes('node-b'));

    engine.destroy();
  });

  it('drops Byzantine messages and increments dropped metric', () => {
    const { engine, deliveredEvents } = createEngine('node-a');
    engine.addPeer('node-b');

    const byzantineEvent: SorobanIndexedEvent = {
      id: 'bad-msg',
      contractId: 'CA3D',
      topic: 'test',
      xdrPayload: 'not-base64!',
      ledgerSeq: -500,
      txHash: '0x123',
      timestamp: Date.now(),
      originPeerId: 'node-b',
    };

    const msg: GossipDataMessage = {
      type: 'GOSSIP_DATA',
      messageId: byzantineEvent.id,
      topic: byzantineEvent.topic,
      event: byzantineEvent,
      hopCount: 0,
      senderId: 'node-b',
      timestamp: Date.now(),
    };

    engine.handleMessage('node-b', msg);

    assert.equal(deliveredEvents.length, 0);
    assert.equal(engine.byzantineDroppedCount, 1);

    engine.destroy();
  });
});
