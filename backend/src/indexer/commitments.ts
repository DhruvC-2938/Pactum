import { Pool } from 'pg';
import { LedgerSnapshot } from './types';

// The registry publishes commitment_created with topics
//   (symbol_short!("created"), issuer: Address, counterparty: Address)
// and the u64 commitment id as the event data. See
// contracts/registry/src/events.rs::commitment_created.
const CREATED_TOPIC = 'created';

// Matches a Stellar public key (G…) or contract (C…) address. Duplicated from
// cache.ts/reputation.ts, which each keep their own copy for the same reason:
// the shape check has no dependencies and does not warrant a shared module.
const STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;

// Pagination bounds for findByAddress. Exported so the route can echo the same
// defaults/ceiling it advertises.
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/** A `commitment_created` event decoded from an indexed ledger. */
export interface CommitmentCreated {
  commitmentId: string;
  issuer: string;
  counterparty: string;
  ledgerSequence: number;
  createdAt: string;
}

/** A row of the address → commitment reverse index, as returned to callers. */
export interface IndexedCommitment {
  commitmentId: string;
  issuer: string;
  counterparty: string;
  ledgerSequence: number | null;
  createdAt: string | null;
}

/** A page of reverse-index lookups plus the effective (clamped) paging used. */
export interface CommitmentPage {
  items: IndexedCommitment[];
  total: number;
  limit: number;
  offset: number;
}

export interface FindByAddressOptions {
  limit?: number;
  offset?: number;
}

/**
 * The reverse index the finality indexer writes to and the API reads from.
 * Implemented in memory (tests) and over PostgreSQL (production).
 */
export interface CommitmentIndex {
  /** Idempotently records commitments seen in a `commitment_created` event. */
  indexCreated(events: CommitmentCreated[]): Promise<void>;
  /** Commitments where `address` is the issuer or the counterparty, newest first. */
  findByAddress(address: string, options?: FindByAddressOptions): Promise<CommitmentPage>;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizePage(options: FindByAddressOptions): { limit: number; offset: number } {
  return {
    limit: clampInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
    offset: clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

// scValToNative returns a bigint for a u64; older encodings can surface a number
// or a decimal string. Normalise to the canonical base-10 string we store.
function commitmentIdToString(id: unknown): string | null {
  if (typeof id === 'bigint' && id >= 0n) return id.toString();
  if (typeof id === 'number' && Number.isInteger(id) && id >= 0) return id.toString();
  if (typeof id === 'string' && /^\d+$/.test(id)) return id;
  return null;
}

/**
 * Decodes every `commitment_created` event carried by an indexed ledger. Topics
 * and the value arrive as base64 ScVal XDR, so the SDK is imported lazily: it
 * ships as an ES module while the indexer is compiled to CommonJS (mirrors
 * cache.ts::addressesInLedger). Events that are not a decodable "created" event
 * are skipped rather than throwing, so one malformed event cannot stall a ledger.
 */
export async function parseCommitmentCreatedEvents(
  ledger: LedgerSnapshot,
): Promise<CommitmentCreated[]> {
  if (ledger.events.length === 0) return [];

  const { scValToNative, xdr } = await import('@stellar/stellar-sdk');

  const decode = (entry: unknown): unknown => {
    if (typeof entry !== 'string') return undefined;
    try {
      return scValToNative(xdr.ScVal.fromXDR(entry, 'base64'));
    } catch {
      return undefined;
    }
  };

  const created: CommitmentCreated[] = [];
  for (const event of ledger.events) {
    const payload = event.payload as { topic?: unknown; value?: unknown } | null;
    if (!payload || typeof payload !== 'object') continue;

    const topic = Array.isArray(payload.topic) ? payload.topic : [];
    if (topic.length < 3 || decode(topic[0]) !== CREATED_TOPIC) continue;

    const issuer = decode(topic[1]);
    const counterparty = decode(topic[2]);
    const commitmentId = commitmentIdToString(decode(payload.value));

    if (typeof issuer !== 'string' || !STELLAR_ADDRESS.test(issuer)) continue;
    if (typeof counterparty !== 'string' || !STELLAR_ADDRESS.test(counterparty)) continue;
    if (commitmentId === null) continue;

    created.push({
      commitmentId,
      issuer,
      counterparty,
      ledgerSequence: ledger.sequence,
      createdAt: ledger.closedAt,
    });
  }

  return created;
}

/**
 * Decodes a ledger's `commitment_created` events and upserts them into `index`.
 * Returns how many commitments were indexed. Suitable as the body of a
 * FinalityIndexer `onLedgerCommitted` hook (see listener.ts).
 */
export async function indexCommitmentsFromLedger(
  ledger: LedgerSnapshot,
  index: CommitmentIndex,
): Promise<number> {
  const created = await parseCommitmentCreatedEvents(ledger);
  if (created.length > 0) await index.indexCreated(created);
  return created.length;
}

// Newest first, matching the SQL `ORDER BY ledger_sequence DESC, commitment_id
// DESC` (DESC defaults to NULLS FIRST, so a null sequence sorts ahead).
function compareNewestFirst(a: IndexedCommitment, b: IndexedCommitment): number {
  const aSeq = a.ledgerSequence;
  const bSeq = b.ledgerSequence;
  if (aSeq !== bSeq) {
    if (aSeq === null) return -1;
    if (bSeq === null) return 1;
    return bSeq - aSeq;
  }
  if (a.commitmentId === b.commitmentId) return 0;
  return a.commitmentId < b.commitmentId ? 1 : -1;
}

/** In-memory reverse index for tests and callers without a database. */
export class InMemoryCommitmentIndex implements CommitmentIndex {
  private readonly byId = new Map<string, IndexedCommitment>();

  async indexCreated(events: CommitmentCreated[]): Promise<void> {
    for (const event of events) {
      this.byId.set(event.commitmentId, {
        commitmentId: event.commitmentId,
        issuer: event.issuer,
        counterparty: event.counterparty,
        ledgerSequence: event.ledgerSequence,
        createdAt: event.createdAt,
      });
    }
  }

  async findByAddress(address: string, options: FindByAddressOptions = {}): Promise<CommitmentPage> {
    const { limit, offset } = normalizePage(options);
    const matches = [...this.byId.values()]
      .filter((c) => c.issuer === address || c.counterparty === address)
      .sort(compareNewestFirst);
    return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset };
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid PostgreSQL schema identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

type CommitmentRow = {
  commitment_id: string;
  issuer: string;
  counterparty: string;
  ledger_sequence: string | number | null;
  created_at: Date | string | null;
};

function rowToIndexedCommitment(row: CommitmentRow): IndexedCommitment {
  const createdAt = row.created_at;
  return {
    commitmentId: row.commitment_id,
    issuer: row.issuer,
    counterparty: row.counterparty,
    ledgerSequence: row.ledger_sequence === null ? null : Number(row.ledger_sequence),
    createdAt:
      createdAt === null
        ? null
        : createdAt instanceof Date
          ? createdAt.toISOString()
          : String(createdAt),
  };
}

export interface PostgresCommitmentIndexOptions {
  schema?: string;
}

/** PostgreSQL-backed reverse index over the `commitment_index` table. */
export class PostgresCommitmentIndex implements CommitmentIndex {
  private readonly table: string;

  constructor(
    private readonly pool: Pool,
    options: PostgresCommitmentIndexOptions = {},
  ) {
    this.table = `${quoteIdentifier(options.schema ?? 'public')}."commitment_index"`;
  }

  async indexCreated(events: CommitmentCreated[]): Promise<void> {
    if (events.length === 0) return;

    const rows: string[] = [];
    const params: unknown[] = [];
    events.forEach((event, i) => {
      const base = i * 5;
      rows.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      params.push(
        event.commitmentId,
        event.issuer,
        event.counterparty,
        event.ledgerSequence,
        event.createdAt,
      );
    });

    // Re-indexing an already-seen commitment (e.g. a backfill overlapping the
    // live stream) rewrites the same row rather than erroring.
    await this.pool.query(
      `INSERT INTO ${this.table}
         (commitment_id, issuer, counterparty, ledger_sequence, created_at)
       VALUES ${rows.join(', ')}
       ON CONFLICT (commitment_id) DO UPDATE SET
         issuer = EXCLUDED.issuer,
         counterparty = EXCLUDED.counterparty,
         ledger_sequence = EXCLUDED.ledger_sequence,
         created_at = EXCLUDED.created_at`,
      params,
    );
  }

  async findByAddress(address: string, options: FindByAddressOptions = {}): Promise<CommitmentPage> {
    const { limit, offset } = normalizePage(options);

    // COUNT(*) OVER() returns the full match count alongside the page, so total
    // and items come back in a single round trip.
    const result = await this.pool.query<CommitmentRow & { total: string }>(
      `SELECT commitment_id, issuer, counterparty, ledger_sequence, created_at,
              COUNT(*) OVER() AS total
         FROM ${this.table}
        WHERE issuer = $1 OR counterparty = $1
        ORDER BY ledger_sequence DESC, commitment_id DESC
        LIMIT $2 OFFSET $3`,
      [address, limit, offset],
    );

    return {
      items: result.rows.map(rowToIndexedCommitment),
      total: result.rows[0] ? Number(result.rows[0].total) : 0,
      limit,
      offset,
    };
  }
}

export interface BackfillOptions {
  schema?: string;
  batchSize?: number;
}

/**
 * Rebuilds the reverse index from the canonical ledgers already in
 * `indexed_ledgers`, decoding their `commitment_created` events. This is the
 * "backfill" path for bringing the index up to date without replaying the chain
 * — e.g. when it is created after ledgers have already been indexed. Idempotent:
 * safe to run repeatedly and safe to overlap with the live indexing hook.
 */
export async function backfillCommitmentIndex(
  pool: Pool,
  index: CommitmentIndex,
  options: BackfillOptions = {},
): Promise<{ ledgers: number; commitments: number }> {
  const table = `${quoteIdentifier(options.schema ?? 'public')}."indexed_ledgers"`;
  const batchSize = Math.max(1, options.batchSize ?? 500);

  let afterSequence = -1;
  let ledgers = 0;
  let commitments = 0;

  for (;;) {
    const result = await pool.query<{ sequence: string; closed_at: Date | string; events: unknown }>(
      `SELECT sequence, closed_at, events
         FROM ${table}
        WHERE sequence > $1
        ORDER BY sequence
        LIMIT $2`,
      [afterSequence, batchSize],
    );
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const snapshot: LedgerSnapshot = {
        sequence: Number(row.sequence),
        hash: '',
        previousHash: null,
        closedAt:
          row.closed_at instanceof Date ? row.closed_at.toISOString() : String(row.closed_at),
        events: Array.isArray(row.events) ? (row.events as LedgerSnapshot['events']) : [],
      };
      commitments += await indexCommitmentsFromLedger(snapshot, index);
      ledgers += 1;
      afterSequence = snapshot.sequence;
    }
  }

  return { ledgers, commitments };
}
