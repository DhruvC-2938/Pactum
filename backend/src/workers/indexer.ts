import { rpc } from '@stellar/stellar-sdk';
import { createRedisClientFromEnv, ReputationCache } from '../cache/reputationCache';
import pool from '../db/timescale';
import { FinalityIndexer } from '../indexer/listener';
import { ReputationCacheProjector } from '../indexer/reputation-projector';
import { createSorobanRpcLedgerClient, SorobanLedgerSource } from '../indexer/rpc-source';
import { PostgresIndexerStore } from '../indexer/store';
import { PostgresReputationRepository } from '../reputation/repository';

const finalityDepth = Number(process.env.INDEXER_FINALITY_DEPTH ?? 2);
const pollInterval = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 1000);
const server = new rpc.Server(
  process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org:443',
  { allowHttp: true },
);
const source = new SorobanLedgerSource(createSorobanRpcLedgerClient(server));
const redis = createRedisClientFromEnv();
redis.on('error', (error) => console.error('Redis connection error', error));

async function run(): Promise<void> {
  const checkpoint = await new PostgresIndexerStore(pool).getCheckpoint();
  const latest = await source.getLatestLedger();
  const startSequence = Number(
    process.env.INDEXER_START_SEQUENCE
      ?? checkpoint?.sequence
      ?? Math.max(1, latest.sequence - finalityDepth),
  );
  const cache = new ReputationCache(redis, new PostgresReputationRepository(pool));
  const projector = new ReputationCacheProjector(cache);
  const indexer = new FinalityIndexer({
    source,
    store: new PostgresIndexerStore(pool),
    finalityDepth,
    startSequence,
    onLedgerCommitted: (ledger) => projector.ledgerCommitted(ledger),
  });

  while (true) {
    try {
      await indexer.sync();
    } catch (error) {
      console.error('Indexer sync failed', error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

void run();
