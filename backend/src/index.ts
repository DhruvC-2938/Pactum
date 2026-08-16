import dotenv from 'dotenv';
import { SorobanClient } from './soroban/client';
import { createOracleWorker, CommitmentMetadata } from './workers/oracle';

// Load environment variables
dotenv.config();

async function main() {
  // Validate required environment variables
  const requiredEnvVars = [
    'SOROBAN_RPC_URL',
    'SOROBAN_NETWORK_PASSPHRASE',
    'SOROBAN_CONTRACT_ID',
    'ORACLE_PRIVATE_KEY'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  // Initialize Soroban client
  const sorobanClient = new SorobanClient({
    rpcUrl: process.env.SOROBAN_RPC_URL!,
    contractId: process.env.SOROBAN_CONTRACT_ID!,
    networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE!,
    privateKey: process.env.ORACLE_PRIVATE_KEY!
  });

  // Example commitment metadata
  // In production, this would come from a database or API
  const commitments: CommitmentMetadata[] = [
    {
      id: 1,
      dueAt: Math.floor(Date.now() / 1000) + 60, // Due in 1 minute for testing
      terms: 'Website uptime 99% this month',
      apiType: 'pingdom',
      threshold: 99,
      metric: 'uptime'
    },
    {
      id: 2,
      dueAt: Math.floor(Date.now() / 1000) + 120, // Due in 2 minutes for testing
      terms: 'API response time < 200ms',
      apiType: 'custom',
      threshold: 95,
      metric: 'response_time'
    }
  ];

  // Create and start the oracle worker
  const worker = await createOracleWorker(
    sorobanClient,
    commitments,
    {
      pollIntervalMs: parseInt(process.env.ORACLE_POLL_INTERVAL_MS || '60000'),
      maxRetries: parseInt(process.env.ORACLE_MAX_RETRIES || '3'),
      retryDelayMs: parseInt(process.env.ORACLE_RETRY_DELAY_MS || '5000')
    }
  );

  console.log('Oracle worker started successfully');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down gracefully...');
    worker.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    worker.stop();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Failed to start oracle worker:', error);
  process.exit(1);
});
