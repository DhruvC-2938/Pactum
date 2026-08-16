import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { ReputationCache } from '../cache/reputationCache';
import { CertificateService } from '../services/CertificateService';

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

export function createReputationRouter(cache: ReputationCache): Router {
  const router = Router();

  // Keep the existing certificate API alongside the low-latency read path.
  router.post('/export/certificate', async (req: Request, res: Response) => {
    const parsed = z.object({
      did: z.string().min(1),
      trustScore: z.number().min(0).max(100),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Bad Request', details: parsed.error.flatten() });
      return;
    }
    try {
      const certificate = await CertificateService.generateReputationCertificate(
        parsed.data.did,
        parsed.data.trustScore,
      );
      res.status(200).json({ message: 'Certificate generated successfully', certificate });
    } catch (error) {
      console.error('Error generating certificate', error);
      res.status(500).json({ error: 'Internal Server Error' });
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

  return router;
}
