import { Router, Request, Response, NextFunction } from 'express';
import { commitmentSchema } from '../schemas/commitment';
import { ZodError } from 'zod';
import { strictLimiter, createCommitmentLimiter } from '../middleware/rateLimiter';

const router = Router();

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
// Two layers of rate limiting protect the on-chain create_commitment call:
//   1. strictLimiter          - 10 writes/min per IP; absorbs raw bursts and
//                               unauthenticated probing before any work is done.
//   2. createCommitmentLimiter - 10/hour per issuing Stellar address (partyA),
//                               applied AFTER validation so only well-formed
//                               requests count against an address's quota.
router.post(
  '/',
  strictLimiter,
  validateCommitment,
  createCommitmentLimiter,
  (req: Request, res: Response) => {
    // Route handler processes the sanitized req.body safely
    res.status(201).json({
      message: 'Commitment created successfully',
      data: req.body,
    });
  },
);

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

// GET /commitments - List commitments
router.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'List commitments' });
});

export default router;
