import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface IntegrationDatabase {
  container: StartedPostgreSqlContainer;
  pool: Pool;
}

// Only the tables the indexer pipeline actually touches (indexed_ledgers,
// indexer_checkpoint, commitment_index). The TimescaleDB migrations
// (001, 007) require the timescale/timescaledb image rather than plain
// postgres, and nothing under test here reads them.
const INDEXER_MIGRATIONS = ['003_deterministic_indexer.sql', '005_commitment_index.sql'];

/**
 * Boots an ephemeral, throwaway Postgres via Testcontainers and applies the
 * indexer's schema to it. Call from a suite's `before`; pair with
 * `stopIntegrationDatabase` in `after` so the container is torn down even if
 * a test in between fails.
 */
export async function startIntegrationDatabase(): Promise<IntegrationDatabase> {
  const container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('pactum_integration')
    .withUsername('pactum')
    .withPassword('pactum')
    .start();

  const pool = new Pool({ connectionString: container.getConnectionUri() });

  // Resolved from the repo-relative cwd (mirrors src/indexer/commitments.test.ts
  // and src/indexer/listener.test.ts) rather than __dirname, since __dirname
  // points at compiled test output under dist-integration-test/, which the
  // build does not copy the .sql migrations into.
  const migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');
  try {
    for (const file of INDEXER_MIGRATIONS) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await pool.query(sql);
    }
  } catch (error) {
    // allSettled, not sequential awaits: a rejection from one cleanup must not
    // skip the other, and neither should replace the original setup error.
    await Promise.allSettled([pool.end(), container.stop()]);
    throw error;
  }

  return { container, pool };
}

/** Closes the pool and stops the container started by `startIntegrationDatabase`. */
export async function stopIntegrationDatabase({
  container,
  pool,
}: IntegrationDatabase): Promise<void> {
  await pool.end();
  await container.stop();
}
