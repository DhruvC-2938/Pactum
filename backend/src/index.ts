import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import analyticsRoutes from './routes/analytics';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Analytics routes for time-series data
app.use('/api/analytics', analyticsRoutes);

// Placeholder for reputation endpoints
app.get('/api/reputation/:address', (req: Request, res: Response) => {
  const { address } = req.params;
  // TODO: Fetch from database/indexer
  res.json({
    address,
    trustScore: 850,
    fulfilled: 10,
    late: 2,
    breached: 0
  });
});

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});
