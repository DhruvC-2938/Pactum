import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import analyticsRoutes from './routes/analytics';
import { startSnapshotCron } from './indexer/cron';
import { closeCache, initCache, isCacheAvailable } from './indexer/cache';
import { EventIndexer, startEventIndexer } from './indexer/listener';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

let eventIndexer: EventIndexer | null = null;

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

initCache().finally(() => {
  const server = app.listen(port, () => {
    console.log(`[server]: Pactum Backend running at http://localhost:${port}`);
  });

  const shutdown = () => {
    server.close(() => {
      Promise.allSettled([
        eventIndexer ? eventIndexer.stop() : Promise.resolve(),
        closeCache(),
      ]).finally(() => process.exit(0));
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});

export default app;
