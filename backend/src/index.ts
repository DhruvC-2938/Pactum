import express from 'express';
import commitmentsRouter from './routes/commitments';
import reputationRouter from './routes/reputation';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Mount the routers
app.use('/commitments', commitmentsRouter);
app.use('/reputation', reputationRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`Pactum Backend running on port ${port}`);
});

export default app;
