import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiSpec, zodToOpenApiSchema } from './openapi';
import { commitmentSchema } from '../schemas/commitment';
import { z } from 'zod';

describe('OpenAPI 3.0 Documentation Generator (Pactum #126)', () => {
  it('should convert Zod primitive and object schemas accurately', () => {
    const testSchema = z.object({
      id: z.string().min(5),
      count: z.number().min(1).max(100),
      active: z.boolean(),
      category: z.enum(['A', 'B', 'C']),
      optionalField: z.string().optional(),
    });

    const openApiSchema = zodToOpenApiSchema(testSchema) as any;
    assert.equal(openApiSchema.type, 'object');
    assert.equal(openApiSchema.properties.id.type, 'string');
    assert.equal(openApiSchema.properties.id.minLength, 5);
    assert.equal(openApiSchema.properties.count.type, 'number');
    assert.equal(openApiSchema.properties.count.minimum, 1);
    assert.equal(openApiSchema.properties.count.maximum, 100);
    assert.equal(openApiSchema.properties.active.type, 'boolean');
    assert.deepEqual(openApiSchema.properties.category.enum, ['A', 'B', 'C']);
    assert.ok(openApiSchema.required.includes('id'));
    assert.ok(!openApiSchema.required.includes('optionalField'));
  });

  it('should generate a valid OpenAPI 3.0.3 document with all endpoints and schemas', () => {
    const spec = buildOpenApiSpec();

    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.title, 'Pactum Trust Layer API');
    assert.ok(spec.paths['/health']);
    assert.ok(spec.paths['/metrics']);
    assert.ok(spec.paths['/commitments']);
    assert.ok(spec.paths['/commitments/{id}']);
    assert.ok(spec.paths['/reputation/{address}']);
    assert.ok(spec.paths['/reputation/export/certificate']);
    assert.ok(spec.paths['/api/analytics']);

    // Check Zod schema derivation
    assert.ok(spec.components.schemas.Commitment);
    const commitmentObj = spec.components.schemas.Commitment as any;
    assert.equal(commitmentObj.type, 'object');
    assert.ok(commitmentObj.properties.issuer);
    assert.ok(commitmentObj.properties.counterparty);
    assert.ok(commitmentObj.properties.due_at);
  });
});
