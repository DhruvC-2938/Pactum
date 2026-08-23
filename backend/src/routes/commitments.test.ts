import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, commitmentQuerySchema, toApiCommitment } from './commitments';

describe('Cursor-Based Keyset Pagination & Filtering (Pactum #124)', () => {
  it('should encode and decode keyset cursor tokens correctly', () => {
    const cursor = {
      time: '2026-08-17T20:00:00.000Z',
      id: 'comm_987654321',
    };

    const token = encodeCursor(cursor);
    assert.ok(typeof token === 'string');
    assert.ok(token.length > 10);

    const decoded = decodeCursor(token);
    assert.deepEqual(decoded, cursor);
  });

  it('should return null for malformed cursor tokens', () => {
    assert.equal(decodeCursor('invalid-token-123'), null);
    assert.equal(decodeCursor(''), null);
    assert.equal(decodeCursor('e30='), null); // empty object "{}"
  });

  it('should validate query parameters with zod schema', () => {
    const validQuery = {
      limit: '15',
      issuer: 'GBZXN7PIRZGNMHGA7289876543210ABCDEF1234567890ABCDEF1234',
      status: 'active',
      template: 'Freeform',
    };

    const parsed = commitmentQuerySchema.safeParse(validQuery);
    assert.ok(parsed.success);
    if (parsed.success) {
      assert.equal(parsed.data.limit, 15);
      assert.equal(parsed.data.status, 'active');
      assert.equal(parsed.data.template, 'Freeform');
    }

    const invalidLimit = {
      limit: '500', // exceeds max 100
    };
    const invalidParsed = commitmentQuerySchema.safeParse(invalidLimit);
    assert.ok(!invalidParsed.success);
  });

  it('maps a commitment_outcomes row onto the shape lib/api.ts consumers expect', () => {
    // CommitmentItem (frontend/src/App.tsx) does `commitment.issuer.charAt(0)`
    // unconditionally -- partyA/partyB, not issuer/counterparty, meant every real row this
    // route returned crashed rendering and the Commitments list silently showed nothing.
    const pending = toApiCommitment({
      time: '2026-08-23T12:57:57.607Z',
      id: '1',
      partyA: 'GISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSU',
      partyB: 'GCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUN',
      status: 'pending',
      outcome: 'pending',
      dueDate: '2026-08-23T12:57:55.000Z',
      completedAt: null,
      createdAt: '2026-08-23T12:57:57.608Z',
    });
    assert.equal(pending.id, 1);
    assert.equal(pending.issuer, 'GISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSU');
    assert.equal(pending.counterparty, 'GCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUN');
    assert.equal(pending.status, 'Pending');
    assert.equal(pending.outcome, null);
    assert.equal(pending.attested_at, null);
    assert.equal(pending.due_at, Math.floor(Date.parse('2026-08-23T12:57:55.000Z') / 1000));

    const fulfilled = toApiCommitment({
      time: '2026-08-23T12:57:57.607Z',
      id: '2',
      partyA: 'GISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSU',
      partyB: 'GCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUN',
      status: 'completed',
      outcome: 'fulfilled',
      dueDate: '2026-08-23T12:57:55.000Z',
      completedAt: '2026-08-24T00:00:00.000Z',
      createdAt: '2026-08-23T12:57:57.608Z',
    });
    assert.equal(fulfilled.status, 'Fulfilled');
    assert.equal(fulfilled.outcome, 'Fulfilled');
    assert.equal(fulfilled.attested_at, Math.floor(Date.parse('2026-08-24T00:00:00.000Z') / 1000));

    const disputed = toApiCommitment({
      time: '2026-08-23T12:57:57.607Z',
      id: '3',
      partyA: 'GISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSUERISSU',
      partyB: 'GCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUNTERPARTYCOUN',
      status: 'disputed',
      outcome: 'disputed',
      dueDate: '2026-08-23T12:57:55.000Z',
      completedAt: null,
      createdAt: '2026-08-23T12:57:57.608Z',
    });
    assert.equal(disputed.status, 'Disputed');
  });
});
