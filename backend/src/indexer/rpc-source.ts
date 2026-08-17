import type { rpc } from '@stellar/stellar-sdk' with { "resolution-mode": "import" };
import { LedgerEvent, LedgerSource, LedgerSnapshot } from './types';

const EVENT_PAGE_LIMIT = 100;

interface RpcLedger {
  sequence: number;
  hash: string;
  ledgerCloseTime: string;
  previousHash?: string | null;
  headerXdr?: unknown;
}

interface RpcEvent {
  id: string;
  type: string;
  ledger: number;
  ledgerClosedAt?: string;
  transactionIndex?: number;
  operationIndex?: number;
  inSuccessfulContractCall?: boolean;
  txHash?: string;
  contractId?: unknown;
  topic?: unknown[];
  value?: unknown;
}

function unixTimestampToIso(value: string): string {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error(`Invalid Stellar ledger close time: ${value}`);
  }

  return new Date(seconds * 1000).toISOString();
}

function isLedgerOutsideRetention(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === -32600
    && typeof candidate.message === 'string'
    && /start ledger .* must be between the oldest ledger:/i.test(candidate.message);
}

export interface RpcEventFilter {
  type: 'contract';
  contractIds: string[];
}

export interface SorobanRpcLedgerClient {
  getLatestLedger(): Promise<{ sequence: number }>;
  getLedgers(request: {
    startLedger: number;
    pagination: { limit: number };
  }): Promise<{ ledgers: RpcLedger[] }>;
  getEvents(request:
    | {
        filters: RpcEventFilter[];
        startLedger: number;
        endLedger: number;
        limit: number;
      }
    | {
        filters: RpcEventFilter[];
        cursor: string;
        limit: number;
      }
  ): Promise<{ events: RpcEvent[]; cursor?: string }>;
}

export function createSorobanRpcLedgerClient(server: rpc.Server): SorobanRpcLedgerClient {
  return {
    getLatestLedger: () => server.getLatestLedger(),
    getLedgers: (request) => server.getLedgers(request),
    getEvents: (request) => server.getEvents(request),
  };
}

function previousHashFromHeader(headerXdr: unknown): string | null {
  if (!headerXdr || typeof headerXdr !== 'object') return null;

  const entry = headerXdr as { header?: () => { previousLedgerHash?: () => unknown } };
  const header = entry.header?.();
  const value = header?.previousLedgerHash?.();
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  return null;
}

function toSerializable(value: unknown): unknown | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'undefined') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) {
    return value
      .map((item) => toSerializable(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === 'object') {
    const candidate = value as {
      toXDR?: (format?: string) => string;
      toString?: () => string;
    };
    if (typeof candidate.toXDR === 'function') return candidate.toXDR('base64');

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && typeof candidate.toString === 'function') {
      return candidate.toString();
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
        const serialized = toSerializable(nested);
        return serialized === undefined ? [] : [[key, serialized]];
      }),
    );
  }

  return undefined;
}

function toEvents(sequence: number, events: RpcEvent[]): LedgerEvent[] {
  return events
    .filter((event) => event.ledger == null || event.ledger === sequence)
    .map((event, index) => ({
      id: event.id ?? `${sequence}:${index}`,
      type: event.type ?? 'soroban',
      payload: toSerializable(event),
    }));
}

export interface SorobanLedgerSourceOptions {
  /**
   * When set, `getEvents` is scoped to this deployed contract, so the indexer
   * only sees events emitted by the Pactum registry.
   */
  contractId?: string;
}

/**
 * Adapts Stellar Soroban RPC responses to the finality indexer's deterministic
 * ledger model. The RPC header supplies the parent hash used for fork checks.
 */
export class SorobanLedgerSource implements LedgerSource {
  private readonly eventFilters: RpcEventFilter[];

  constructor(
    private readonly rpc: SorobanRpcLedgerClient,
    options: SorobanLedgerSourceOptions = {},
  ) {
    this.eventFilters = options.contractId
      ? [{ type: 'contract', contractIds: [options.contractId] }]
      : [];
  }

  async getLatestLedger(): Promise<{ sequence: number }> {
    return this.rpc.getLatestLedger();
  }

  async getLedger(sequence: number): Promise<LedgerSnapshot | null> {
    let response: Awaited<ReturnType<SorobanRpcLedgerClient['getLedgers']>>;
    try {
      response = await this.rpc.getLedgers({
        startLedger: sequence,
        pagination: { limit: 1 },
      });
    } catch (error) {
      if (isLedgerOutsideRetention(error)) return null;
      throw error;
    }
    const ledger = response.ledgers.find((candidate) => candidate.sequence === sequence);
    if (!ledger) return null;

    const previousHash =
      ledger.previousHash ?? previousHashFromHeader(ledger.headerXdr);
    if (sequence > 1 && !previousHash) {
      throw new Error(`Soroban RPC ledger ${sequence} did not include its parent hash`);
    }

    let eventResponse = await this.rpc.getEvents({
      filters: this.eventFilters,
      startLedger: sequence,
      endLedger: sequence + 1,
      limit: EVENT_PAGE_LIMIT,
    });
    const events = [...eventResponse.events];
    let cursor = eventResponse.cursor;

    while (eventResponse.events.length === EVENT_PAGE_LIMIT && cursor) {
      eventResponse = await this.rpc.getEvents({
        filters: this.eventFilters,
        cursor,
        limit: EVENT_PAGE_LIMIT,
      });
      events.push(...eventResponse.events);
      if (!eventResponse.cursor || eventResponse.cursor === cursor) break;
      cursor = eventResponse.cursor;
    }

    return {
      sequence: ledger.sequence,
      hash: ledger.hash,
      previousHash,
      closedAt: unixTimestampToIso(ledger.ledgerCloseTime),
      events: toEvents(sequence, events),
    };
  }
}
