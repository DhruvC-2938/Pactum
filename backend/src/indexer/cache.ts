import { Pool } from 'pg';

/**
 * Persisted cursor state for the Horizon SSE indexer.
 * The cursor is the Horizon paging_token of the last successfully processed event.
 * It is stored in PostgreSQL so the indexer can resume exactly where it left off
 * after a restart or stream disconnect, preventing duplicate processing.
 */
export interface CursorState {
  cursor: string;
  updatedAt: Date;
}

/**
 * In-memory cursor cache used in tests or when no database is available.
 */
export class InMemoryCursorCache {
  private cursor: string | null = null;

  async getCursor(): Promise<string | null> {
    return this.cursor;
  }

  async saveCursor(cursor: string): Promise<void> {
    this.cursor = cursor;
  }

  async clear(): Promise<void> {
    this.cursor = null;
  }
}

/**
 * PostgreSQL-backed cursor cache that persists the latest Horizon SSE paging_token.
 *
 * Uses a single-row upsert keyed on `stream_name` so multiple independent SSE
 * streams (e.g. one per contract) can share the same table without collisions.
 *
 * On stream disconnect the cursor remains intact in the database, allowing the
 * indexer to reconnect and resume from the last successfully processed event.
 */
export class PostgresCursorCache {
  private readonly table: string;

  constructor(
    private readonly pool: Pool,
    private readonly streamName: string = 'horizon_sse',
    schema: string = 'public',
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
      throw new Error(`Invalid PostgreSQL schema identifier: ${schema}`);
    }
    this.table = `"${schema}"."indexer_cursors"`;
  }

  /**
   * Retrieves the persisted cursor for this stream, or null if none exists yet.
   * Returns null on a missing table so the indexer can start from the beginning.
   */
  async getCursor(): Promise<string | null> {
    try {
      const result = await this.pool.query<{ cursor: string }>(
        `SELECT cursor FROM ${this.table} WHERE stream_name = $1`,
        [this.streamName],
      );
      return result.rows[0]?.cursor ?? null;
    } catch (error: unknown) {
      // Table does not exist yet — treat as no cursor.
      if (
        error instanceof Error &&
        error.message.includes('does not exist')
      ) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Persists the cursor atomically.  Safe to call from concurrent indexer
   * instances — the last writer wins, which is correct because Horizon cursors
   * are monotonically increasing paging tokens.
   */
  async saveCursor(cursor: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (stream_name, cursor, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (stream_name) DO UPDATE
         SET cursor     = EXCLUDED.cursor,
             updated_at = EXCLUDED.updated_at`,
      [this.streamName, cursor],
    );
  }

  /**
   * Removes the persisted cursor for this stream.
   * Use when you want the indexer to replay from the beginning on next start.
   */
  async clear(): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE stream_name = $1`,
      [this.streamName],
    );
  }
}
