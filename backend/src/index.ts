import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import analyticsRoutes from './routes/analytics';
import { startSnapshotCron } from './indexer/cron';
import { closeCache, initCache, isCacheAvailable } from './indexer/cache';
import { standardLimiter, strictLimiter } from './middleware/rateLimiter';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Security headers (helmet-equivalent)
// Sets HSTS, X-Content-Type-Options, X-Frame-Options, and related headers on
// every response to harden the API against common web vulnerabilities.
// ---------------------------------------------------------------------------
app.use((_req: Request, res: Response, next: NextFunction): void => {
  // Strict-Transport-Security: enforce HTTPS for 1 year, include subdomains
  res.setHeader(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  // Prevent MIME-type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Disallow framing of this page (clickjacking protection)
  res.setHeader('X-Frame-Options', 'DENY');
  // Disable legacy X-XSS-Protection header (modern browsers ignore it; setting
  // to 0 prevents a known IE vulnerability)
  res.setHeader('X-XSS-Protection', '0');
  // Restrict what can be loaded by the page
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  // Hide the server implementation detail
  res.removeHeader('X-Powered-By');
  // Control referrer information leakage
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Prevent browsers from requesting permission-gated features
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
});

// ---------------------------------------------------------------------------
// Rate limiting
// POST / PUT / PATCH / DELETE requests use the strict limiter (10 req/min).
// All other requests (GET, HEAD, OPTIONS) use the standard limiter (100 req/min).
// ---------------------------------------------------------------------------
app.use((req: Request, res: Response, next: NextFunction): void => {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (writeMethods.has(req.method)) {
    strictLimiter(req, res, next);
  } else {
    standardLimiter(req, res, next);
  }
});

app.use(cors());
app.use(express.json());

// Health check route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    cache: isCacheAvailable(),
    timestamp: new Date().toISOString(),
  });
});

// Mount the routers
app.use('/commitments', commitmentsRouter);
app.use('/reputation', reputationRouter);
// Also mounted here because that is where the placeholder handler used to live.
app.use('/api/reputation', reputationRouter);
app.use('/api/analytics', analyticsRoutes);

if (process.env.REPUTATION_SNAPSHOT_CRON !== 'off') {
  startSnapshotCron();
}

initCache().finally(() => {
  const server = app.listen(port, () => {
    console.log(`[server]: Pactum Backend running at http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      closeCache().finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

export default app;
