import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import analyticsRoutes from './routes/analytics';

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
app.use('/reputation', reputationRouter);
app.use('/api/analytics', analyticsRoutes);

app.listen(port, () => {
  console.log(`[server]: Pactum Backend running at http://localhost:${port}`);
});

export default app;