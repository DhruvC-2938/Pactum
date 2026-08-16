import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import { createReputationRouter } from './routes/reputation';
import analyticsRoutes from './routes/analytics';
import pool from './db/timescale';
import { PostgresReputationRepository } from './reputation/repository';
import { createRedisClientFromEnv, ReputationCache } from './cache/reputationCache';

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Health check route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount the routers
app.use('/commitments', commitmentsRouter);
const redis = createRedisClientFromEnv();
redis.on('error', (error) => console.error('Redis connection error', error));
const reputationCache = new ReputationCache(
  redis,
  new PostgresReputationRepository(pool),
  { ttlSeconds: Number(process.env.REPUTATION_CACHE_TTL_SECONDS ?? 300) },
);
app.use('/reputation', createReputationRouter(reputationCache));
app.use('/api/analytics', analyticsRoutes);

app.listen(port, () => {
  console.log(`[server]: Pactum Backend running at http://localhost:${port}`);
});

export default app;
