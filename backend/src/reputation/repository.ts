import { Pool } from 'pg';
import { Reputation, ReputationRepository } from './types';

type ReputationRow = {
  address: string;
  trust_score: number;
  total_commitments: number;
  fulfilled_commitments: number;
  late_commitments: number;
  breached_commitments: number;
  fulfillment_rate: string | number;
  time: Date | string;
};

export class PostgresReputationRepository implements ReputationRepository {
  constructor(private readonly pool: Pool) {}

  async findByAddress(address: string): Promise<Reputation | null> {
    const result = await this.pool.query<ReputationRow>(
      `SELECT address, trust_score, total_commitments, fulfilled_commitments,
              late_commitments, breached_commitments, fulfillment_rate, time
       FROM trust_score_snapshots
       WHERE address = $1
       ORDER BY time DESC
       LIMIT 1`,
      [address],
    );
    const row = result.rows[0];
    if (!row) return null;

    return {
      address: row.address,
      trustScore: Number(row.trust_score),
      totalCommitments: Number(row.total_commitments),
      fulfilledCommitments: Number(row.fulfilled_commitments),
      lateCommitments: Number(row.late_commitments),
      breachedCommitments: Number(row.breached_commitments),
      fulfillmentRate: Number(row.fulfillment_rate),
      updatedAt: row.time instanceof Date ? row.time.toISOString() : String(row.time),
    };
  }
}
