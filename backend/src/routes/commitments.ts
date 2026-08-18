import { Router, Request, Response, NextFunction } from 'express';
import { commitmentSchema } from '../schemas/commitment';
import { ZodError } from 'zod';
import { strictLimiter } from '../middleware/rateLimiter';
import pool from '../db/timescale';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PostgresCommitmentIndex,
} from '../indexer/commitments';

const router = Router();

// Reverse index over the shared TimescaleDB pool, populated by the indexer from
// on-chain `commitment_created` events. See src/indexer/commitments.ts.
const commitmentIndex = new PostgresCommitmentIndex(pool);

const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

// Query params arrive as string | string[] | undefined; take the integer form
// of a single string value, otherwise fall back (findByAddress clamps range).
const parseIntParam = (value: unknown, fallback: number): number => {
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const roleOf = (address: string, issuer: string, counterparty: string): string => {
  const isIssuer = issuer === address;
  const isCounterparty = counterparty === address;
  if (isIssuer && isCounterparty) return 'both';
  return isIssuer ? 'issuer' : 'counterparty';
};

/**
 * Validation middleware using Zod.
 * Rejects invalid payloads with a 400 Bad Request and structured error details.
 * Strips undocumented fields from the request body automatically via Zod's parse method.
 */
const validateCommitment = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // `.parse()` strips any undocumented fields by default unless `.strict()` is used.
    const validatedData = commitmentSchema.parse(req.body);
    req.body = validatedData; // Replace body with sanitized & validated data
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

// POST /commitments - Create a new commitment
// strictLimiter enforces a 10 req/IP/min cap on this write endpoint.
router.post('/', strictLimiter, validateCommitment, (req: Request, res: Response) => {
  // Route handler processes the sanitized req.body safely
  res.status(201).json({ 
    message: 'Commitment created successfully', 
    data: req.body 
  });
});

// PUT /commitments/:id - Update an existing commitment
// strictLimiter enforces a 10 req/IP/min cap on this write endpoint.
router.put('/:id', strictLimiter, validateCommitment, (req: Request, res: Response) => {
  // Route handler processes the sanitized req.body safely
  res.status(200).json({ 
    message: 'Commitment updated successfully', 
    data: req.body 
  });
});

// GET /commitments/:id - Fetch a commitment by ID
router.get('/:id', (req: Request, res: Response) => {
  res.status(200).json({ message: 'Get commitment', id: req.params.id });
});

// GET /commitments?address=<stellar_address> - List commitments an address is party to
//
// Address-based lookup the registry cannot serve on-chain (it only exposes
// get_commitment(id)). Results come from the reverse index the indexer builds
// from `commitment_created` events, returning the commitments where the address
// is the issuer or the counterparty, newest first. Paginated with `limit`
// (default 50, max 200) and `offset`.
router.get('/', async (req: Request, res: Response) => {
  const { address } = req.query;

  // `address` is required: this endpoint queries by party. Listing every
  // commitment in the registry is intentionally not offered here.
  if (typeof address !== 'string') {
    res.status(400).json({ error: "Query parameter 'address' is required" });
    return;
  }
  if (!STELLAR_ADDRESS.test(address)) {
    res.status(400).json({ error: 'Invalid Stellar address' });
    return;
  }

  try {
    const { items, total, limit, offset } = await commitmentIndex.findByAddress(address, {
      limit: parseIntParam(req.query.limit, DEFAULT_LIMIT),
      offset: parseIntParam(req.query.offset, 0),
    });

    res.json({
      address,
      pagination: { limit, offset, total },
      commitments: items.map((commitment) => ({
        ...commitment,
        role: roleOf(address, commitment.issuer, commitment.counterparty),
      })),
    });
  } catch (error) {
    console.error('Error fetching commitments by address:', error);
    res.status(500).json({ error: 'Failed to fetch commitments' });
  }
});

export default router;
