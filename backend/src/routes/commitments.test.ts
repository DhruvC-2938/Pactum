import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCursor, decodeCursor, commitmentQuerySchema } from './commitments';

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
});
