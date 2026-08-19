import { Router, Request, Response } from 'express';
import { RelayerService } from '../relayer/relayerService';

export function createProofsRouter(relayerService: RelayerService): Router {
  const router = Router();

  /**
   * GET /trust-score/:address
   * Returns a zero-trust cryptographic state proof (PactumStateProof) for the requested address.
   * Query params:
   *   - ledgerSeq (optional): target ledger sequence
   */
  router.get('/trust-score/:address', async (req: Request, res: Response): Promise<void> => {
    const rawAddress = req.params.address;
    const address = Array.isArray(rawAddress) ? rawAddress[0] : rawAddress;

    if (!address || address.length < 10) {
      res.status(400).json({ error: 'Invalid Stellar address or contract identifier' });
      return;
    }

    let targetLedgerSeq: number | undefined;
    if (req.query.ledgerSeq !== undefined) {
      const ledgerSeqStr = String(req.query.ledgerSeq).trim();
      if (!/^[1-9]\d*$/.test(ledgerSeqStr)) {
        res.status(400).json({ error: 'ledgerSeq query parameter must be a positive integer' });
        return;
      }
      const parsed = Number(ledgerSeqStr);
      if (!Number.isSafeInteger(parsed) || parsed > 4294967295) {
        res.status(400).json({ error: 'ledgerSeq query parameter must be a valid uint32 integer' });
        return;
      }
      targetLedgerSeq = parsed;
    }

    try {
      const proof = await relayerService.getProofForAddress(address, {
        targetLedgerSeq,
      });

      res.status(200).json({
        success: true,
        proof,
      });
    } catch (error) {
      console.error(`Failed to generate state proof for ${address}:`, error);
      res.status(500).json({
        error: 'Failed to generate zero-trust state proof',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}

export default createProofsRouter;
