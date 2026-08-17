import pool from '../db/timescale';
import { insertCommitmentOutcome, updateCommitmentOutcome } from '../workers/timescaleSnapshot';
import { invalidateLedger } from './cache';
import { CommitmentCreatedEvent, parseLedgerEvents } from './events';
import { createSorobanRpcLedgerClient, SorobanLedgerSource } from './rpc-source';
import { PostgresIndexerStore } from './store';
import {
  IndexerStore,
  LedgerCheckpoint,
  LedgerSnapshot,
  LedgerSource,
} from './types';

export interface FinalityIndexerOptions {
  source: LedgerSource;
  store: IndexerStore;
  finalityDepth: number;
  startSequence?: number;
  maxBatchSize?: number;
  maxRollbackDepth?: number;
  /**
   * Invoked after each ledger is committed, so downstream caches can be
   * invalidated for the addresses it touched. Failures are logged and
   * swallowed: a committed ledger is canonical whether or not a cache noticed.
   */
  onLedgerCommitted?: (ledger: LedgerSnapshot) => void | Promise<void>;
}

export interface SyncResult {
  latestSequence: number;
  finalizedSequence: number;
  committed: number;
  rolledBackFrom: number | null;
  checkpoint: LedgerCheckpoint | null;
}

export class LedgerLinkageError extends Error {
  constructor(
    public readonly sequence: number,
    public readonly expectedPreviousHash: string,
    public readonly receivedPreviousHash: string | null,
  ) {
    super(
      `Ledger ${sequence} links to ${receivedPreviousHash}, expected ${expectedPreviousHash}`,
    );
    this.name = 'LedgerLinkageError';
  }
}

export class NoCommonAncestorError extends Error {
  constructor(sequence: number) {
    super(`Could not find a canonical ancestor for checkpoint ${sequence}`);
    this.name = 'NoCommonAncestorError';
  }
}

export class FinalityIndexer {
  private readonly startSequence: number;

  private readonly maxBatchSize: number;

  private readonly maxRollbackDepth: number;

  constructor(private readonly options: FinalityIndexerOptions) {
    if (!Number.isInteger(options.finalityDepth) || options.finalityDepth < 0) {
      throw new Error('finalityDepth must be a non-negative integer');
    }

    this.startSequence = options.startSequence ?? 1;
    this.maxBatchSize = options.maxBatchSize ?? 100;
    this.maxRollbackDepth = options.maxRollbackDepth
      ?? Math.max(100, options.finalityDepth * 2);
    if (!Number.isInteger(this.startSequence) || this.startSequence < 1) {
      throw new Error('startSequence must be a positive integer');
    }
    if (!Number.isInteger(this.maxBatchSize) || this.maxBatchSize < 1) {
      throw new Error('maxBatchSize must be a positive integer');
    }
    if (!Number.isInteger(this.maxRollbackDepth) || this.maxRollbackDepth < 1) {
      throw new Error('maxRollbackDepth must be a positive integer');
    }
  }

  async sync(): Promise<SyncResult> {
    const latest = await this.options.source.getLatestLedger();
    const finalizedSequence = Math.max(
      0,
      latest.sequence - this.options.finalityDepth,
    );
    let checkpoint = await this.options.store.getCheckpoint();
    let rolledBackFrom: number | null = null;

    if (checkpoint) {
      const canonicalCheckpoint = checkpoint.sequence <= latest.sequence
        ? await this.options.source.getLedger(checkpoint.sequence)
        : null;
      if (!canonicalCheckpoint || canonicalCheckpoint.hash !== checkpoint.hash) {
        const ancestorSequence = await this.findCommonAncestor(
          checkpoint.sequence,
          Math.min(latest.sequence, finalizedSequence),
        );
        if (ancestorSequence === null) {
          throw new NoCommonAncestorError(checkpoint.sequence);
        }

        await this.options.store.rollbackTo(ancestorSequence);
        rolledBackFrom = checkpoint.sequence;
        checkpoint = await this.options.store.getCheckpoint();
      }
    }

    let nextSequence = checkpoint ? checkpoint.sequence + 1 : this.startSequence;
    const endSequence = Math.min(
      finalizedSequence,
      nextSequence + this.maxBatchSize - 1,
    );
    let committed = 0;

    while (nextSequence <= endSequence) {
      const ledger = await this.options.source.getLedger(nextSequence);
      if (!ledger) {
        throw new Error(`Canonical source did not return ledger ${nextSequence}`);
      }
      if (checkpoint && ledger.previousHash !== checkpoint.hash) {
        throw new LedgerLinkageError(nextSequence, checkpoint.hash, ledger.previousHash);
      }

      await this.options.store.appendLedger(ledger);
      checkpoint = { sequence: ledger.sequence, hash: ledger.hash };
      nextSequence += 1;
      committed += 1;

      if (this.options.onLedgerCommitted) {
        try {
          await this.options.onLedgerCommitted(ledger);
        } catch (error) {
          console.error(`[indexer] Ledger ${ledger.sequence} commit hook failed:`, error);
        }
      }
    }

    return {
      latestSequence: latest.sequence,
      finalizedSequence,
      committed,
      rolledBackFrom,
      checkpoint,
    };
  }

  private async findCommonAncestor(
    sequence: number,
    canonicalCeiling: number,
  ): Promise<number | null> {
    const firstCandidate = Math.min(sequence - 1, canonicalCeiling);
    const floor = Math.max(this.startSequence, sequence - this.maxRollbackDepth);
    let sawCanonicalCandidate = false;

    for (let candidate = firstCandidate; candidate >= floor; candidate -= 1) {
      const stored = await this.options.store.getLedger(candidate);
      if (!stored) continue;

      const canonical = await this.options.source.getLedger(candidate);
      if (canonical) sawCanonicalCandidate = true;
      if (canonical?.hash === stored.hash) return candidate;
    }

    return floor === this.startSequence && sawCanonicalCandidate ? 0 : null;
  }
}

export interface EventIndexerConfig {
  rpcUrl: string;
  contractId: string;
  finalityDepth?: number;
  startSequence?: number;
  maxBatchSize?: number;
  pollIntervalMs?: number;
}

export interface EventIndexer {
  sync(): Promise<SyncResult | null>;
  stop(): Promise<void>;
  /** The in-memory cache of commitments parsed so far, keyed by commitment id. */
  cachedCommitments(): ReadonlyMap<string, CommitmentCreatedEvent>;
}

/**
 * Boots the running event listener: a Soroban RPC source scoped to the deployed
 * contract, the PostgreSQL ledger store, and a finality-aware indexer whose
 * commit hook parses each ledger's contract events, persists them into the
 * Timescale `commitment_outcomes` table reputation routes read from, and
 * invalidates the Redis reputation cache for every touched address. A poll
 * loop keeps the indexer caught up; failures are logged and retried on the
 * next tick so a flaky RPC never takes the service down.
 */
export const startEventIndexer = (config: EventIndexerConfig): EventIndexer => {
  const pollIntervalMs = Math.max(1_000, config.pollIntervalMs ?? 15_000);
  const commitments = new Map<string, CommitmentCreatedEvent>();
  let indexer: FinalityIndexer | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let syncing = false;

  const commit = async (ledger: LedgerSnapshot): Promise<void> => {
    const closedAt = new Date(ledger.closedAt);
    const events = await parseLedgerEvents(ledger);

    for (const event of events) {
      switch (event.type) {
        case 'created':
          // The created event is the only one carrying the parties, so it seeds
          // the outcome row; later events enrich that same commitment id. The
          // in-memory map guards replays (e.g. after a reorg) from duplicating.
          if (commitments.has(event.commitmentId)) break;
          commitments.set(event.commitmentId, event);
          await insertCommitmentOutcome({
            commitmentId: event.commitmentId,
            partyA: event.issuer,
            partyB: event.counterparty,
            amount: 0,
            status: 'created',
            outcome: 'pending',
            dueDate: closedAt,
          });
          break;
        case 'attested':
          await updateCommitmentOutcome(event.commitmentId, 'attested', event.outcome, closedAt);
          break;
        case 'disputed':
          await updateCommitmentOutcome(event.commitmentId, 'disputed', 'disputed', closedAt);
          break;
        case 'resolved':
          await updateCommitmentOutcome(event.commitmentId, 'resolved', event.outcome, closedAt);
          break;
      }
    }

    await invalidateLedger(ledger);
  };

  const sync = async (): Promise<SyncResult | null> => {
    if (!indexer || stopped || syncing) return null;
    syncing = true;
    try {
      return await indexer.sync();
    } catch (error) {
      console.error('[indexer] Poll failed:', error);
      return null;
    } finally {
      syncing = false;
    }
  };

  const bootstrap = async (): Promise<void> => {
    const { rpc } = await import('@stellar/stellar-sdk');
    const server = new rpc.Server(config.rpcUrl, { allowHttp: true });
    const source = new SorobanLedgerSource(
      createSorobanRpcLedgerClient(server),
      { contractId: config.contractId },
    );
    indexer = new FinalityIndexer({
      source,
      store: new PostgresIndexerStore(pool),
      finalityDepth: config.finalityDepth ?? 0,
      startSequence: config.startSequence,
      maxBatchSize: config.maxBatchSize,
      onLedgerCommitted: commit,
    });

    await sync();
    if (!stopped) {
      timer = setInterval(() => void sync(), pollIntervalMs);
      timer.unref?.();
    }
  };

  const ready = bootstrap().catch((error: unknown) => {
    console.error('[indexer] Startup failed, the listener will not poll:', error);
  });

  return {
    sync,
    cachedCommitments: () => commitments,
    stop: async () => {
      stopped = true;
      if (timer) clearInterval(timer);
      await ready;
    },
  };
};
