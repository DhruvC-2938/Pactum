import { Pool, PoolClient } from 'pg';
import { IndexerStore, LedgerCheckpoint, LedgerSnapshot } from './types';

function copyLedger(ledger: LedgerSnapshot): LedgerSnapshot {
  return {
    ...ledger,
    events: ledger.events.map((event) => ({ ...event })),
  };
}

export class InMemoryIndexerStore implements IndexerStore {
  private readonly ledgers = new Map<number, LedgerSnapshot>();

  private checkpoint: LedgerCheckpoint | null = null;

  async getCheckpoint(): Promise<LedgerCheckpoint | null> {
    return this.checkpoint ? { ...this.checkpoint } : null;
  }

  async getLedger(sequence: number): Promise<LedgerSnapshot | null> {
    const ledger = this.ledgers.get(sequence);
    return ledger ? copyLedger(ledger) : null;
  }

  async appendLedger(ledger: LedgerSnapshot): Promise<void> {
    const current = this.checkpoint;
    if (current && ledger.sequence !== current.sequence + 1) {
      throw new Error(
        `Cannot append ledger ${ledger.sequence} after checkpoint ${current.sequence}`,
      );
    }
    if (current && ledger.previousHash !== current.hash) {
      throw new Error(
        `Ledger ${ledger.sequence} links to ${ledger.previousHash}, expected ${current.hash}`,
      );
    }

    this.ledgers.set(ledger.sequence, copyLedger(ledger));
    this.checkpoint = { sequence: ledger.sequence, hash: ledger.hash };
  }

  async rollbackTo(sequence: number): Promise<void> {
    for (const existingSequence of this.ledgers.keys()) {
      if (existingSequence > sequence) this.ledgers.delete(existingSequence);
    }

    if (sequence <= 0) {
      this.checkpoint = null;
      return;
    }

    const ledger = this.ledgers.get(sequence);
    if (!ledger) throw new Error(`Cannot roll back to missing ledger ${sequence}`);
    this.checkpoint = { sequence, hash: ledger.hash };
  }
}

type LedgerRow = {
  sequence: string | number;
  ledger_hash: string;
  previous_hash: string | null;
  closed_at: Date | string;
  events: unknown;
};

export interface PostgresIndexerStoreOptions {
  schema?: string;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid PostgreSQL schema identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

function rowToLedger(row: LedgerRow): LedgerSnapshot {
  const events = Array.isArray(row.events) ? row.events : [];
  return {
    sequence: Number(row.sequence),
    hash: row.ledger_hash,
    previousHash: row.previous_hash,
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : String(row.closed_at),
    events: events as LedgerSnapshot['events'],
  };
}

export class PostgresIndexerStore implements IndexerStore {
  private readonly schema: string;

  private readonly indexedLedgersTable: string;

  private readonly checkpointTable: string;

  constructor(
    private readonly pool: Pool,
    options: PostgresIndexerStoreOptions = {},
  ) {
    this.schema = options.schema ?? 'public';
    const schemaIdentifier = quoteIdentifier(this.schema);
    this.indexedLedgersTable = `${schemaIdentifier}."indexed_ledgers"`;
    this.checkpointTable = `${schemaIdentifier}."indexer_checkpoint"`;
  }

  async ensureSchema(): Promise<void> {
    if (this.schema !== 'public') {
      await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(this.schema)}`);
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.indexedLedgersTable} (
        sequence BIGINT PRIMARY KEY,
        ledger_hash TEXT NOT NULL,
        previous_hash TEXT,
        closed_at TIMESTAMPTZ NOT NULL,
        events JSONB NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ${this.checkpointTable} (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        sequence BIGINT NOT NULL,
        ledger_hash TEXT NOT NULL
      );
    `);
  }

  async getCheckpoint(): Promise<LedgerCheckpoint | null> {
    const result = await this.pool.query<{ sequence: string; ledger_hash: string }>(
      `SELECT sequence, ledger_hash FROM ${this.checkpointTable} WHERE singleton = TRUE`,
    );
    const row = result.rows[0];
    return row ? { sequence: Number(row.sequence), hash: row.ledger_hash } : null;
  }

  async getLedger(sequence: number): Promise<LedgerSnapshot | null> {
    const result = await this.pool.query<LedgerRow>(
      `SELECT sequence, ledger_hash, previous_hash, closed_at, events
       FROM ${this.indexedLedgersTable}
       WHERE sequence = $1`,
      [sequence],
    );
    const row = result.rows[0];
    return row ? rowToLedger(row) : null;
  }

  async appendLedger(ledger: LedgerSnapshot): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const checkpointResult = await client.query<{
        sequence: string;
        ledger_hash: string;
      }>(
        `SELECT sequence, ledger_hash
         FROM ${this.checkpointTable}
         WHERE singleton = TRUE
         FOR UPDATE`,
      );
      const checkpoint = checkpointResult.rows[0];
      const existing = await client.query<{ ledger_hash: string }>(
        `SELECT ledger_hash FROM ${this.indexedLedgersTable}
         WHERE sequence = $1
         FOR UPDATE`,
        [ledger.sequence],
      );
      if (existing.rows[0] && existing.rows[0].ledger_hash !== ledger.hash) {
        throw new Error(`Ledger ${ledger.sequence} already contains a different hash`);
      }

      if (checkpoint) {
        const checkpointSequence = Number(checkpoint.sequence);
        if (ledger.sequence === checkpointSequence) {
          if (checkpoint.ledger_hash !== ledger.hash) {
            throw new Error(`Checkpoint ${ledger.sequence} already contains a different hash`);
          }
          await client.query('COMMIT');
          return;
        }
        if (ledger.sequence !== checkpointSequence + 1) {
          throw new Error(
            `Cannot append ledger ${ledger.sequence} after checkpoint ${checkpointSequence}`,
          );
        }
        if (ledger.previousHash !== checkpoint.ledger_hash) {
          throw new Error(
            `Ledger ${ledger.sequence} links to ${ledger.previousHash}, expected ${checkpoint.ledger_hash}`,
          );
        }
      }

      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO ${this.indexedLedgersTable}
             (sequence, ledger_hash, previous_hash, closed_at, events)
           VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            ledger.sequence,
            ledger.hash,
            ledger.previousHash,
            ledger.closedAt,
            JSON.stringify(ledger.events),
          ],
        );
      }

      await client.query(
        `INSERT INTO ${this.checkpointTable} (singleton, sequence, ledger_hash)
         VALUES (TRUE, $1, $2)
         ON CONFLICT (singleton) DO UPDATE
         SET sequence = EXCLUDED.sequence, ledger_hash = EXCLUDED.ledger_hash`,
        [ledger.sequence, ledger.hash],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackTo(sequence: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT sequence
         FROM ${this.checkpointTable}
         WHERE singleton = TRUE
         FOR UPDATE`,
      );
      await client.query(
        `DELETE FROM ${this.indexedLedgersTable} WHERE sequence > $1`,
        [sequence],
      );

      if (sequence <= 0) {
        await client.query(
          `DELETE FROM ${this.checkpointTable} WHERE singleton = TRUE`,
        );
      } else {
        const result = await client.query<{ ledger_hash: string }>(
          `SELECT ledger_hash FROM ${this.indexedLedgersTable} WHERE sequence = $1`,
          [sequence],
        );
        const row = result.rows[0];
        if (!row) throw new Error(`Cannot roll back to missing ledger ${sequence}`);
        await client.query(
          `INSERT INTO ${this.checkpointTable} (singleton, sequence, ledger_hash)
           VALUES (TRUE, $1, $2)
           ON CONFLICT (singleton) DO UPDATE
           SET sequence = EXCLUDED.sequence, ledger_hash = EXCLUDED.ledger_hash`,
          [sequence, row.ledger_hash],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

export type IndexerPoolClient = Pool | PoolClient;
