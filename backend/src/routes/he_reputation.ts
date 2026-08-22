/**
 * Homomorphic Reputation Routes — Issue #190
 *
 * Exposes two endpoints:
 *
 *   POST /reputation/encrypted/submit
 *     Accepts an encrypted outcome payload (ciphertext + range proof) for an
 *     address, verifies the proof off-chain, and accumulates the ciphertext
 *     into the address's encrypted aggregate in `he_reputation_scores`.
 *
 *   GET /reputation/encrypted/:address
 *     Returns the homomorphically computed and decrypted aggregate trust score
 *     for an address.  Individual ratings are never exposed.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { HomomorphicReputationService } from '../services/HomomorphicReputationService';
import { verifyRangeProof, PEDERSEN_P } from '../crypto/bulletproof';
import { toEncryptedScore } from '../crypto/paillier';
import type { OutcomeKind } from '../services/HomomorphicReputationService';

const router = Router();

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

/** Validates a non-empty lowercase hex string. */
const hexString = z
  .string()
  .min(1)
  .regex(/^[0-9a-f]+$/, 'must be a lowercase hex string');

const submitSchema = z.object({
  /** Stellar address of the issuer. */
  address: z.string().regex(STELLAR_ADDRESS, 'invalid Stellar address'),

  /** Outcome kind: "fulfilled", "late", or "breached". */
  outcomeKind: z.enum(['fulfilled', 'late', 'breached']),

  /**
   * Paillier ciphertext as `{ lo, hi, count }` with BigInt values sent as
   * decimal strings (JSON has no native BigInt).
   */
  encOutcome: z.object({
    lo: z.string().regex(/^\d+$/, 'lo must be a decimal string'),
    hi: z.string().regex(/^\d+$/, 'hi must be a decimal string'),
    count: z.number().int().min(0),
  }),

  /** Zero-knowledge range proof (hex-encoded scalars). */
  proof: z.object({
    commitment: hexString,
    witnessA: hexString,
    witnessB: hexString,
  }),

  /** Paillier public-key modulus `n` (hex). */
  pkN: hexString,
});

// ---------------------------------------------------------------------------
// POST /reputation/encrypted/submit
// ---------------------------------------------------------------------------

router.post(
  '/encrypted/submit',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let body: z.infer<typeof submitSchema>;
    try {
      body = submitSchema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: 'Bad Request',
          details: err.errors.map((e) => ({ field: e.path.join('.'), message: e.message })),
        });
        return;
      }
      next(err);
      return;
    }

    const { address, outcomeKind, encOutcome, proof, pkN } = body;

    // Verify the range proof off-chain before persisting anything.
    const proofObj = {
      commitment: BigInt('0x' + proof.commitment),
      witnessA: BigInt('0x' + proof.witnessA),
      witnessB: BigInt('0x' + proof.witnessB),
    };
    const pkNBig = BigInt('0x' + pkN);

    if (!verifyRangeProof(proofObj, pkNBig)) {
      res.status(400).json({ error: 'Range proof verification failed' });
      return;
    }

    // Reconstruct EncryptedScore from the submitted decimal strings.
    const ciphertext = (BigInt(encOutcome.hi) << 64n) | BigInt(encOutcome.lo);
    const encScore = toEncryptedScore(ciphertext, encOutcome.count);

    try {
      const svc = HomomorphicReputationService.getInstance();
      await svc.accumulateEncryptedOutcome(address, encScore, outcomeKind as OutcomeKind);

      res.status(200).json({ message: 'Encrypted outcome accumulated successfully' });
    } catch (error) {
      console.error('[HE Reputation] accumulateEncryptedOutcome failed:', error);
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /reputation/encrypted/:address
// ---------------------------------------------------------------------------

router.get(
  '/encrypted/:address',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { address } = req.params;

    if (!STELLAR_ADDRESS.test(String(address))) {
      res.status(400).json({ error: 'Invalid Stellar address' });
      return;
    }

    try {
      const svc = HomomorphicReputationService.getInstance();
      const result = await svc.getDecryptedScore(String(address));

      res.json({
        address: result.address,
        trustScore: result.trustScore,
        fulfilledCount: result.fulfilledCount,
        lateCount: result.lateCount,
        breachedCount: result.breachedCount,
        computedAt: result.computedAt.toISOString(),
      });
    } catch (error) {
      console.error('[HE Reputation] getDecryptedScore failed:', error);
      next(error);
    }
  },
);

export default router;
