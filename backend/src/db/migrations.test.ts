import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMigrationChecksum } from './timescale';

describe('Immutable Database Migration Tooling (Pactum #125)', () => {
  it('should compute consistent SHA-256 checksums for migration SQL files', () => {
    const sql1 = 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name VARCHAR(255));';
    const sql2 = 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name VARCHAR(255));';
    const sql3 = 'CREATE TABLE test_table (id SERIAL PRIMARY KEY, name VARCHAR(100));';

    const hash1 = calculateMigrationChecksum(sql1);
    const hash2 = calculateMigrationChecksum(sql2);
    const hash3 = calculateMigrationChecksum(sql3);

    assert.equal(hash1, hash2);
    assert.notEqual(hash1, hash3);
    assert.equal(hash1.length, 64);
  });

  it('should ignore outer whitespace differences during checksum calculation', () => {
    const rawSql = 'CREATE TABLE users (id INT);';
    const paddedSql = '  \n CREATE TABLE users (id INT);\n\t ';

    assert.equal(calculateMigrationChecksum(rawSql), calculateMigrationChecksum(paddedSql));
  });
});
