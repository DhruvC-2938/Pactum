import { Router, Request, Response } from 'express';
import { queryTimescale } from '../db/timescale';

const router = Router();

// GET /api/analytics/network/daily - Get daily network stats
router.get('/network/daily', async (req: Request, res: Response) => {
  try {
    const { days = 30 } = req.query;
    const limit = Math.min(parseInt(days as string), 365); // Max 1 year

    const result = await queryTimescale(
      `SELECT * FROM mv_daily_fulfillment_rates 
       ORDER BY day DESC 
       LIMIT $1`,
      [limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching daily network stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch daily network stats',
    });
  }
});

// GET /api/analytics/network/weekly - Get weekly network stats
router.get('/network/weekly', async (req: Request, res: Response) => {
  try {
    const { weeks = 52 } = req.query;
    const limit = Math.min(parseInt(weeks as string), 260); // Max 5 years

    const result = await queryTimescale(
      `SELECT * FROM mv_weekly_fulfillment_rates 
       ORDER BY week DESC 
       LIMIT $1`,
      [limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching weekly network stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch weekly network stats',
    });
  }
});

// GET /api/analytics/network/monthly - Get monthly network stats
router.get('/network/monthly', async (req: Request, res: Response) => {
  try {
    const { months = 24 } = req.query;
    const limit = Math.min(parseInt(months as string), 120); // Max 10 years

    const result = await queryTimescale(
      `SELECT * FROM mv_monthly_fulfillment_rates 
       ORDER BY month DESC 
       LIMIT $1`,
      [limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching monthly network stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch monthly network stats',
    });
  }
});

// GET /api/analytics/network/moving-averages - Get moving averages
router.get('/network/moving-averages', async (req: Request, res: Response) => {
  try {
    const { days = 90 } = req.query;
    const limit = Math.min(parseInt(days as string), 365); // Max 1 year

    const result = await queryTimescale(
      `SELECT * FROM mv_moving_averages 
       ORDER BY day DESC 
       LIMIT $1`,
      [limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching moving averages:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch moving averages',
    });
  }
});

// GET /api/analytics/network/trust-trends - Get trust score trends
router.get('/network/trust-trends', async (req: Request, res: Response) => {
  try {
    const { days = 90 } = req.query;
    const limit = Math.min(parseInt(days as string), 365); // Max 1 year

    const result = await queryTimescale(
      `SELECT * FROM mv_trust_score_trends 
       ORDER BY day DESC 
       LIMIT $1`,
      [limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching trust score trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trust score trends',
    });
  }
});

// GET /api/analytics/network/summary - Get current network summary
router.get('/network/summary', async (req: Request, res: Response) => {
  try {
    const result = await queryTimescale(
      `SELECT 
        (SELECT COUNT(*) FROM commitment_outcomes WHERE time >= NOW() - INTERVAL '24 hours') as commitments_24h,
        (SELECT COUNT(*) FILTER (WHERE outcome = 'fulfilled') FROM commitment_outcomes WHERE time >= NOW() - INTERVAL '24 hours') as fulfilled_24h,
        (SELECT COUNT(*) FILTER (WHERE outcome = 'breached') FROM commitment_outcomes WHERE time >= NOW() - INTERVAL '24 hours') as breached_24h,
        (SELECT ROUND(AVG(trust_score), 2) FROM trust_score_snapshots WHERE time >= NOW() - INTERVAL '24 hours') as avg_trust_score_24h,
        (SELECT COUNT(DISTINCT address) FROM trust_score_snapshots WHERE time >= NOW() - INTERVAL '24 hours') as active_addresses_24h`,
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error('Error fetching network summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch network summary',
    });
  }
});

// GET /api/analytics/address/:address/trust-history - Get trust score history for an address
router.get('/address/:address/trust-history', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { days = 30 } = req.query;
    const limit = Math.min(parseInt(days as string), 365);

    const result = await queryTimescale(
      `SELECT * FROM trust_score_snapshots 
       WHERE address = $1 
       ORDER BY time DESC 
       LIMIT $2`,
      [address, limit],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching trust history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trust history',
    });
  }
});

// GET /api/analytics/address/:address/commitments - Get commitment outcomes for an address
router.get('/address/:address/commitments', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = 50 } = req.query;
    const limitNum = Math.min(parseInt(limit as string), 500);

    const result = await queryTimescale(
      `SELECT * FROM commitment_outcomes 
       WHERE party_a = $1 OR party_b = $1 
       ORDER BY time DESC 
       LIMIT $2`,
      [address, limitNum],
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error('Error fetching address commitments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch address commitments',
    });
  }
});

// GET /api/analytics/breach-rates - Get breach rate trends for market analysis
router.get('/breach-rates', async (req: Request, res: Response) => {
  try {
    const { period = 'month' } = req.query;
    const validPeriods = ['day', 'week', 'month'];
    const timeBucket = validPeriods.includes(period as string) ? period : 'month';

    const result = await queryTimescale(
      `SELECT 
        time_bucket($1::interval, time) as period,
        COUNT(*) FILTER (WHERE outcome = 'breached')::DECIMAL / NULLIF(COUNT(*), 0) as breach_rate,
        COUNT(*) as total_commitments,
        COUNT(*) FILTER (WHERE outcome = 'breached') as total_breached
       FROM commitment_outcomes
       WHERE time >= NOW() - INTERVAL '12 months'
       GROUP BY time_bucket($1::interval, time)
       ORDER BY period DESC`,
      [`1 ${timeBucket}`],
    );

    res.json({
      success: true,
      data: result.rows,
      period: timeBucket,
    });
  } catch (error) {
    console.error('Error fetching breach rates:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch breach rates',
    });
  }
});

export default router;
