import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import analyticsRoutes from './routes/analytics';
import client from 'prom-client';
import { startSnapshotCron } from './indexer/cron';
import { closeCache, initCache, isCacheAvailable } from './indexer/cache';
import { standardLimiter, strictLimiter } from './middleware/rateLimiter';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const metricsPort = process.env.METRICS_PORT || 9090;

// Prometheus metrics setup
const register = new client.Registry();

// HTTP request latency histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Active WebSocket connections gauge (placeholder for future WebSocket implementation)
const activeWebSocketConnections = new client.Gauge({
  name: 'websocket_active_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
});

// Collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

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

// Middleware to track HTTP request duration
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    httpRequestDuration
      .labels(req.method, req.path, res.statusCode.toString())
      .observe(duration);
  });
  next();
});

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

// Metrics endpoint for Prometheus scraping
app.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

if (process.env.INDEXER_ENABLED !== 'off') {
  const rpcUrl = process.env.SOROBAN_RPC_URL;
  const contractId = process.env.SOROBAN_CONTRACT_ID;
  if (rpcUrl && contractId) {
    const finalityDepth = parseInt(process.env.INDEXER_FINALITY_DEPTH ?? '0', 10);
    const pollIntervalMs = parseInt(process.env.INDEXER_POLL_INTERVAL_MS ?? '15000', 10);
    const startSequence = process.env.INDEXER_START_SEQUENCE
      ? parseInt(process.env.INDEXER_START_SEQUENCE, 10)
      : undefined;

    eventIndexer = startEventIndexer({
      rpcUrl,
      contractId,
      finalityDepth: Number.isNaN(finalityDepth) ? 0 : finalityDepth,
      pollIntervalMs: Number.isNaN(pollIntervalMs) ? 15000 : pollIntervalMs,
      startSequence: Number.isNaN(startSequence as number) ? undefined : startSequence,
    });
    console.log('[indexer] Soroban RPC event listener started');
  } else {
    console.log('[indexer] SOROBAN_RPC_URL/SOROBAN_CONTRACT_ID not set, event listener disabled');
  }
}

// Start separate metrics server on internal port
const metricsApp = express();
metricsApp.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

initCache().finally(() => {
  const server = app.listen(port, () => {
    console.log(`[server]: Pactum Backend API running at http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      Promise.allSettled([
        eventIndexer ? eventIndexer.stop() : Promise.resolve(),
        closeCache(),
      ]).finally(() => process.exit(0));
    });
  };

metricsApp.listen(metricsPort, () => {
  console.log(`[metrics]: Prometheus metrics endpoint running at http://localhost:${metricsPort}/metrics`);
});

export default app;
