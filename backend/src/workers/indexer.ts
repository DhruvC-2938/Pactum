import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { ContractEvent, parseLedgerEvents } from '../indexer/events';
import { createRedisClientFromEnv, ReputationCache } from '../cache/reputationCache';
import pool from '../db/timescale';
import { FinalityIndexer } from '../indexer/listener';
import { ReputationCacheProjector } from '../indexer/reputation-projector';
import { createSorobanRpcLedgerClient, SorobanLedgerSource } from '../indexer/rpc-source';
import { PostgresIndexerStore } from '../indexer/store';
import { PostgresReputationRepository } from '../reputation/repository';
import { insertCommitmentOutcome, updateCommitmentOutcome } from './timescaleSnapshot';

const finalityDepth = Number(process.env.INDEXER_FINALITY_DEPTH ?? 2);
const pollInterval = Number(process.env.INDEXER_POLL_INTERVAL_MS ?? 1000);
const rpcUrl = process.env.SOROBAN_RPC_URL ?? 'https://soroban-testnet.stellar.org:443';
const contractId = process.env.SOROBAN_CONTRACT_ID;
const networkPassphrase = process.env.SOROBAN_NETWORK_PASSPHRASE;
const server = new rpc.Server(rpcUrl, { allowHttp: true });
const source = new SorobanLedgerSource(createSorobanRpcLedgerClient(server));
const redis = createRedisClientFromEnv();
redis.on('error', (error) => console.error('Redis connection error', error));

/**
 * Reads a commitment's `due_at` straight from the contract via `get_commitment`. The
 * `commitment_created` event only carries (issuer, counterparty, oracle) as topics and
 * (id, schema_id) as its value -- due_at isn't in there, so populating commitment_outcomes'
 * NOT NULL due_date column on `created` needs this extra read (same technique as
 * backend/src/soroban/client.ts's getCommitment / frontend's fetchArbitrator). Read-only, so
 * an ephemeral stub account is enough -- no signing key required.
 */
async function fetchDueAt(commitmentId: string): Promise<Date | null> {
  if (!contractId || !networkPassphrase) return null;
  try {
    const contract = new Contract(contractId);
    const stub = new Account(Keypair.random().publicKey(), '0');
    const transaction = new TransactionBuilder(stub, { fee: BASE_FEE, networkPassphrase })
      .addOperation(
        contract.call('get_commitment', nativeToScVal(BigInt(commitmentId), { type: 'u64' })),
      )
      .setTimeout(30)
      .build();

    const simulation = await server.simulateTransaction(transaction);
    if (rpc.Api.isSimulationError(simulation) || !simulation.result) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = scValToNative(simulation.result.retval);
    return new Date(Number(raw.due_at) * 1000);
  } catch (error) {
    console.error(`Failed to fetch due_at for commitment ${commitmentId}`, error);
    return null;
  }
}

/**
 * Projects a decoded contract event into commitment_outcomes -- the table
 * routes/commitments.ts's GET / actually reads from. Nothing else in the indexer wrote to
 * it before this (insertCommitmentOutcome/updateCommitmentOutcome existed but were never
 * called), so the Commitments list could never show a commitment, pending or otherwise.
 *
 * The table's `amount`/`currency` columns predate this contract's data model -- a Pactum
 * Commitment has no monetary amount at all -- so `amount` is always stored as 0; there is no
 * real value to put there.
 */
async function projectCommitmentOutcome(
  event: ContractEvent,
  ledgerClosedAt: string,
): Promise<void> {
  switch (event.type) {
    case 'created': {
      const dueAt = await fetchDueAt(event.commitmentId);
      await insertCommitmentOutcome({
        commitmentId: event.commitmentId,
        partyA: event.issuer,
        partyB: event.counterparty,
        amount: 0,
        status: 'pending',
        outcome: 'pending',
        dueDate: dueAt ?? new Date(ledgerClosedAt),
      });
      return;
    }
    case 'attested':
    case 'resolved':
      await updateCommitmentOutcome(
        event.commitmentId,
        'completed',
        event.outcome,
        new Date(ledgerClosedAt),
      );
      return;
    case 'disputed':
      // Not actually completed yet -- leave completed_at null rather than stamping the
      // dispute time into a column named for final resolution.
      await updateCommitmentOutcome(event.commitmentId, 'disputed', 'disputed', null);
      return;
  }
}

async function run(): Promise<void> {
  const checkpoint = await new PostgresIndexerStore(pool).getCheckpoint();
  const latest = await source.getLatestLedger();
  const startSequence = Number(
    process.env.INDEXER_START_SEQUENCE ??
      checkpoint?.sequence ??
      Math.max(1, latest.sequence - finalityDepth),
  );
  const cache = new ReputationCache(redis, new PostgresReputationRepository(pool));
  const projector = new ReputationCacheProjector(cache);
  const indexer = new FinalityIndexer({
    source,
    store: new PostgresIndexerStore(pool),
    finalityDepth,
    startSequence,
    onLedgerCommitted: async (ledger) => {
      await projector.ledgerCommitted(ledger);
      const events = await parseLedgerEvents(ledger);
      for (const event of events) {
        redis.publish('pactum:events', JSON.stringify({ ...event, sequence: ledger.sequence }));
        try {
          await projectCommitmentOutcome(event, ledger.closedAt);
        } catch (error) {
          console.error('Failed to project commitment_outcomes for event', event, error);
        }
      }
    },
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
