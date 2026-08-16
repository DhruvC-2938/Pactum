import {
  IndexerStore,
  LedgerCheckpoint,
  LedgerSnapshot,
  LedgerSource,
} from './types';
import client from 'prom-client';

// Prometheus metrics for indexer
const eventsIndexedTotal = new client.Counter({
  name: 'events_indexed_total',
  help: 'Total number of events indexed by the indexer',
});

const indexerLagSeconds = new client.Gauge({
  name: 'indexer_lag_seconds',
  help: 'Current indexer lag in seconds (difference between latest and finalized sequence)',
});

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

    // Update Prometheus metrics
    eventsIndexedTotal.inc(committed);
    indexerLagSeconds.set(latest.sequence - finalizedSequence);

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
