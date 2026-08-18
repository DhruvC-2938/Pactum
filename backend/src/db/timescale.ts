import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({
  host: process.env.TIMESCALEDB_HOST || 'localhost',
  port: parseInt(process.env.TIMESCALEDB_PORT || '5432'),
  database: process.env.TIMESCALEDB_DATABASE || 'pactum_timeseries',
  user: process.env.TIMESCALEDB_USER || 'postgres',
  password: process.env.TIMESCALEDB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const getTimescaleClient = async (): Promise<PoolClient> => {
  return await pool.connect();
};

export const queryTimescale = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed TimescaleDB query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('TimescaleDB query error:', error);
    throw error;
  }
};

export const runMigrations = async () => {
  const client = await getTimescaleClient();
  try {
    await client.query('BEGIN');

    const migrationsDir = path.join(__dirname, 'migrations');
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`Running migration: ${file}`);
      await client.query(sql);
    }

    await client.query('COMMIT');
    console.log('All migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

export const refreshMaterializedViews = async () => {
  const views = [
    'mv_daily_fulfillment_rates',
    'mv_weekly_fulfillment_rates',
    'mv_monthly_fulfillment_rates',
    'mv_moving_averages',
    'mv_trust_score_trends',
  ];

  for (const view of views) {
    const start = Date.now();
    try {
      await queryTimescale(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`);
      const duration = Date.now() - start;
      console.log(`Refreshed materialized view ${view} in ${duration}ms`);
    } catch (error) {
      console.error(`Failed to refresh ${view}:`, error);
      // Fallback to non-concurrent refresh if concurrent fails
      try {
        await queryTimescale(`REFRESH MATERIALIZED VIEW ${view}`);
        console.log(`Refreshed ${view} with non-concurrent refresh`);
      } catch (fallbackError) {
        console.error(`Failed to refresh ${view} with fallback:`, fallbackError);
      }
    }
  }
};

export default pool;
