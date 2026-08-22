import { describe, it, expect } from 'vitest';
import { PeerScoringManager } from '../peerScoring.ts';
import type { SorobanIndexedEvent } from '../types.ts';

describe('PeerScoringManager', () => {
  it('rewards peer score on delivering valid messages', () => {
    const manager = new PeerScoringManager();
    const peerId = 'peer-alice';

    manager.recordValidMessage(peerId);
    let rep = manager.getReputation(peerId);
    expect(rep.score).toBe(5);
    expect(rep.validMessagesDelivered).toBe(1);

    manager.recordValidMessage(peerId);
    rep = manager.getReputation(peerId);
    expect(rep.score).toBe(10);
    expect(rep.validMessagesDelivered).toBe(2);
  });

  it('penalizes duplicate messages and updates duplicate count', () => {
    const manager = new PeerScoringManager();
    const peerId = 'peer-bob';

    manager.recordDuplicateMessage(peerId);
    const rep = manager.getReputation(peerId);
    expect(rep.score).toBe(-2);
    expect(rep.duplicateMessages).toBe(1);
  });

  it('quarantines and bans peers broadcasting invalid or Byzantine state', () => {
    const manager = new PeerScoringManager({
      quarantineThreshold: -25,
      banThreshold: -50,
    });
    const peerId = 'peer-malicious';

    // Invalid message (-40)
    manager.recordInvalidMessage(peerId, false);
    let rep = manager.getReputation(peerId);
    expect(rep.score).toBe(-40);
    expect(rep.isQuarantined).toBe(true);
    expect(rep.isBanned).toBe(false);
    expect(manager.isPeerEligibleForEagerGossip(peerId)).toBe(false);

    // Byzantine attack (-80) -> crosses ban threshold (-50)
    manager.recordInvalidMessage(peerId, true);
    rep = manager.getReputation(peerId);
    expect(rep.score).toBe(-100);
    expect(rep.isBanned).toBe(true);
    expect(manager.isPeerBanned(peerId)).toBe(true);
  });

  it('validates Soroban events correctly', () => {
    const manager = new PeerScoringManager();

    const validEvent: SorobanIndexedEvent = {
      id: 'valid-123',
      contractId: 'C123',
      topic: 'transfer',
      xdrPayload: btoa('valid-xdr-binary-data'),
      ledgerSeq: 100500,
      txHash: '0xabc',
      timestamp: Date.now(),
      originPeerId: 'peer-alice',
    };

    const validResult = manager.validateSorobanEvent(validEvent);
    expect(validResult.isValid).toBe(true);

    const invalidSeqEvent: SorobanIndexedEvent = {
      ...validEvent,
      ledgerSeq: -1,
    };
    const invalidResult = manager.validateSorobanEvent(invalidSeqEvent);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.isByzantine).toBe(true);
  });

  it('decays scores periodically towards neutral baseline', () => {
    const manager = new PeerScoringManager({ decayFactor: 0.5 });
    const peerId = 'peer-recovering';

    manager.recordValidMessage(peerId);
    manager.recordValidMessage(peerId); // score = 10

    manager.decayScores();
    const rep = manager.getReputation(peerId);
    expect(rep.score).toBe(5);
  });
});
