import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import analyticsRoutes from './routes/analytics';
import { startSnapshotCron } from './indexer/cron';
import { closeCache, initCache, isCacheAvailable } from './indexer/cache';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

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
