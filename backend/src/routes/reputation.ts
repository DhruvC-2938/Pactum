import { Router, Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { CertificateService } from '../services/CertificateService';

const router = Router();

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

// Using an async wrapper for Express 4 promise handling if needed,
// but the try/catch inside the route handler catches the errors manually here.

export default router;
