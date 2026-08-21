import { queryTimescale } from '../db/timescale';

interface TrustScoreSnapshot {
  address: string;
  trustScore: number;
  totalCommitments: number;
  fulfilledCommitments: number;
  lateCommitments: number;
  breachedCommitments: number;
}

interface CommitmentOutcome {
  commitmentId: string;
  partyA: string;
  partyB?: string;
  amount: number;
  currency?: string;
  status: string;
  outcome: string;
  dueDate: Date;
  completedAt?: Date;
}

export const insertTrustScoreSnapshot = async (snapshot: TrustScoreSnapshot): Promise<void> => {
  const fulfillmentRate =
    snapshot.totalCommitments > 0 ? snapshot.fulfilledCommitments / snapshot.totalCommitments : 0;

  await queryTimescale(
    `INSERT INTO trust_score_snapshots 
     (time, address, trust_score, total_commitments, fulfilled_commitments, 
      late_commitments, breached_commitments, fulfillment_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (time, address) DO UPDATE SET
       trust_score = EXCLUDED.trust_score,
       total_commitments = EXCLUDED.total_commitments,
       fulfilled_commitments = EXCLUDED.fulfilled_commitments,
       late_commitments = EXCLUDED.late_commitments,
       breached_commitments = EXCLUDED.breached_commitments,
       fulfillment_rate = EXCLUDED.fulfillment_rate`,
    [
      new Date(),
      snapshot.address,
      snapshot.trustScore,
      snapshot.totalCommitments,
      snapshot.fulfilledCommitments,
      snapshot.lateCommitments,
      snapshot.breachedCommitments,
      fulfillmentRate,
    ],
  );
};

export const insertCommitmentOutcome = async (outcome: CommitmentOutcome): Promise<void> => {
  await queryTimescale(
    `INSERT INTO commitment_outcomes 
     (time, commitment_id, party_a, party_b, amount, currency, status, outcome, due_date, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      new Date(),
      outcome.commitmentId,
      outcome.partyA,
      outcome.partyB || null,
      outcome.amount,
      outcome.currency || null,
      outcome.status,
      outcome.outcome,
      outcome.dueDate,
      outcome.completedAt || null,
    ],
  );
};

export const updateCommitmentOutcome = async (
  commitmentId: string,
  status: string,
  outcome: string,
  completedAt: Date,
): Promise<void> => {
  await queryTimescale(
    `UPDATE commitment_outcomes
        SET status = $2,
            outcome = $3,
            completed_at = $4
      WHERE commitment_id = $1`,
    [commitmentId, status, outcome, completedAt],
  );
};

export const batchInsertTrustScores = async (snapshots: TrustScoreSnapshot[]): Promise<void> => {
  if (snapshots.length === 0) return;

  const values = snapshots
    .map((snapshot, index) => {
      const fulfillmentRate =
        snapshot.totalCommitments > 0
          ? snapshot.fulfilledCommitments / snapshot.totalCommitments
          : 0;
      const baseIndex = index * 8;
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8})`;
    })
    .join(', ');

  const params = snapshots.flatMap((snapshot) => {
    const fulfillmentRate =
      snapshot.totalCommitments > 0 ? snapshot.fulfilledCommitments / snapshot.totalCommitments : 0;
    return [
      new Date(),
      snapshot.address,
      snapshot.trustScore,
      snapshot.totalCommitments,
      snapshot.fulfilledCommitments,
      snapshot.lateCommitments,
      snapshot.breachedCommitments,
      fulfillmentRate,
    ];
  });

  await queryTimescale(
    `INSERT INTO trust_score_snapshots 
     (time, address, trust_score, total_commitments, fulfilled_commitments, 
      late_commitments, breached_commitments, fulfillment_rate)
     VALUES ${values}
     ON CONFLICT (time, address) DO UPDATE SET
       trust_score = EXCLUDED.trust_score,
       total_commitments = EXCLUDED.total_commitments,
       fulfilled_commitments = EXCLUDED.fulfilled_commitments,
       late_commitments = EXCLUDED.late_commitments,
       breached_commitments = EXCLUDED.breached_commitments,
       fulfillment_rate = EXCLUDED.fulfillment_rate`,
    params,
  );
};

export const batchInsertCommitmentOutcomes = async (
  outcomes: CommitmentOutcome[],
): Promise<void> => {
  if (outcomes.length === 0) return;

  const values = outcomes
    .map((outcome, index) => {
      const baseIndex = index * 10;
      return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10})`;
    })
    .join(', ');

  const params = outcomes.flatMap((outcome) => [
    new Date(),
    outcome.commitmentId,
    outcome.partyA,
    outcome.partyB || null,
    outcome.amount,
    outcome.currency || null,
    outcome.status,
    outcome.outcome,
    outcome.dueDate,
    outcome.completedAt || null,
  ]);

  await queryTimescale(
    `INSERT INTO commitment_outcomes 
     (time, commitment_id, party_a, party_b, amount, currency, status, outcome, due_date, completed_at)
     VALUES ${values}`,
    params,
  );
};

export const snapshotNetworkDailyStats = async (): Promise<void> => {
  const result = await queryTimescale(
    `SELECT 
      COUNT(*) as total_commitments,
      COUNT(*) FILTER (WHERE outcome = 'fulfilled') as total_fulfilled,
      COUNT(*) FILTER (WHERE outcome = 'late') as total_late,
      COUNT(*) FILTER (WHERE outcome = 'breached') as total_breached,
      COUNT(*) FILTER (WHERE outcome = 'disputed') as total_disputed,
      COUNT(DISTINCT party_a) + COUNT(DISTINCT party_b) - COUNT(DISTINCT CASE WHEN party_a = party_b THEN party_a END) as unique_addresses,
      COALESCE(SUM(amount), 0) as total_volume
     FROM commitment_outcomes
     WHERE time >= date_trunc('day', NOW())`,
  );

  const stats = result.rows[0];
  const fulfillmentRate =
    stats.total_commitments > 0 ? stats.total_fulfilled / stats.total_commitments : 0;
  const breachRate =
    stats.total_commitments > 0 ? stats.total_breached / stats.total_commitments : 0;

  await queryTimescale(
    `INSERT INTO network_daily_stats 
     (time, total_commitments, total_fulfilled, total_late, total_breached, 
      total_disputed, fulfillment_rate, breach_rate, unique_addresses, total_volume)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (time) DO UPDATE SET
       total_commitments = EXCLUDED.total_commitments,
       total_fulfilled = EXCLUDED.total_fulfilled,
       total_late = EXCLUDED.total_late,
       total_breached = EXCLUDED.total_breached,
       total_disputed = EXCLUDED.total_disputed,
       fulfillment_rate = EXCLUDED.fulfillment_rate,
       breach_rate = EXCLUDED.breach_rate,
       unique_addresses = EXCLUDED.unique_addresses,
       total_volume = EXCLUDED.total_volume`,
    [
      new Date(),
      stats.total_commitments,
      stats.total_fulfilled,
      stats.total_late,
      stats.total_breached,
      stats.total_disputed,
      fulfillmentRate,
      breachRate,
      stats.unique_addresses,
      stats.total_volume,
    ],
  );
};
