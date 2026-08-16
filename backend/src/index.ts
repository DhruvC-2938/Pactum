import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import analyticsRoutes from './routes/analytics';
import client from 'prom-client';

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

// Start main API server
app.listen(port, () => {
  console.log(`[server]: Pactum Backend API running at http://localhost:${port}`);
});

// Start separate metrics server on internal port
const metricsApp = express();
metricsApp.get('/metrics', async (req: Request, res: Response) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

metricsApp.listen(metricsPort, () => {
  console.log(`[metrics]: Prometheus metrics endpoint running at http://localhost:${metricsPort}/metrics`);
});

export default app;
