import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { ReputationCache } from '../cache/reputationCache';
import { CertificateService } from '../services/CertificateService';
import { queryTimescale } from '../db/timescale';

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;
const DEFAULT_HISTORY_DAYS = 30;
const MAX_HISTORY_DAYS = 365;

// Zod schema for validating the export certificate request
const exportCertificateSchema = z.object({
  did: z.string().min(1, "DID is required"),
  trustScore: z.number().min(0).max(100, "Trust score must be between 0 and 100")
});

const validateExportRequest = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const validatedData = exportCertificateSchema.parse(req.body);
    req.body = validatedData;
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      const formattedErrors = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      res.status(400).json({
        error: 'Bad Request',
        details: formattedErrors,
      });
      return;
    }
    next(error);
  }
};

export function createReputationRouter(cache: ReputationCache): Router {
  const router = Router();

  // POST /export/certificate - Exports a Reputation Certificate (VC)
  router.post('/export/certificate', validateExportRequest, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { did, trustScore } = req.body;

      // Generate the Verifiable Credential using our KMS-backed service
      const token = await CertificateService.generateReputationCertificate(did, trustScore);

      res.status(200).json({
        message: 'Certificate generated successfully',
        certificate: token
      });
    } catch (error) {
      console.error('Error generating certificate:', error);
      res.status(500).json({
        error: 'Internal Server Error'
      });
    }
  });

  router.get('/:address', async (req: Request, res: Response) => {
    const rawAddress = req.params.address;
    const address = (Array.isArray(rawAddress) ? rawAddress[0] : rawAddress).toUpperCase();
    if (!STELLAR_ADDRESS.test(address)) {
      res.status(400).json({ error: 'Invalid Stellar account address' });
      return;
    }

    try {
      const result = await cache.get(address);
      res.setHeader('X-Cache', result.hit ? 'HIT' : 'MISS');
      if (!result.value) {
        res.status(404).json({ error: 'Reputation not found', address });
        return;
      }
      res.status(200).json(result.value);
    } catch (error) {
      console.error('Failed to fetch reputation', error);
      res.status(503).json({ error: 'Reputation service unavailable' });
    }
  });

  // GET /:address/history - Daily reputation snapshots for an address
  router.get('/:address/history', async (req: Request, res: Response) => {
    const { address } = req.params;
    const requested = parseInt(String(req.query.days ?? DEFAULT_HISTORY_DAYS), 10);
    const days = Number.isNaN(requested)
      ? DEFAULT_HISTORY_DAYS
      : Math.min(Math.max(requested, 1), MAX_HISTORY_DAYS);

    try {
      // Snapshots are only written on days an address was active, so each day in
      // the window carries the most recent snapshot at or before it forward.
      const result = await queryTimescale(
        `SELECT
           to_char(series.day, 'YYYY-MM-DD') AS date,
           COALESCE(snapshot.fulfilled, 0) AS fulfilled,
           COALESCE(snapshot.late, 0) AS late,
           COALESCE(snapshot.breached, 0) AS breached
         FROM generate_series(
           CURRENT_DATE - $1::interval,
           CURRENT_DATE,
           '1 day'::interval
         ) AS series(day)
         LEFT JOIN LATERAL (
           SELECT fulfilled, late, breached
           FROM reputation_snapshots
           WHERE address = $2 AND date <= series.day
           ORDER BY date DESC
           LIMIT 1
         ) snapshot ON true
         ORDER BY series.day ASC`,
        [`${days - 1} days`, address],
      );
      res.json(result.rows);
    } catch (error) {
      console.error('Failed to fetch reputation history', error);
      res.status(500).json({ error: 'Database query failed' });
    }
  });

  return router;
}
