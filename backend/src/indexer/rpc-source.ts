import type { rpc } from '@stellar/stellar-sdk' with { "resolution-mode": "import" };
import { LedgerEvent, LedgerSource, LedgerSnapshot } from './types';

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

export interface SorobanRpcLedgerClient {
  getLatestLedger(): Promise<{ sequence: number }>;
  getLedgers(request: {
    startLedger: number;
    pagination: { limit: number };
  }): Promise<{ ledgers: RpcLedger[] }>;
  getEvents(request: {
    filters: [];
    startLedger: number;
    endLedger: number;
  }): Promise<{ events: RpcEvent[] }>;
}

export function createSorobanRpcLedgerClient(server: rpc.Server): SorobanRpcLedgerClient {
  return {
    getLatestLedger: () => server.getLatestLedger(),
    getLedgers: (request) => server.getLedgers(request),
    getEvents: ({ startLedger, endLedger }) =>
      server.getEvents({ filters: [], startLedger, endLedger }),
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

function toSerializable(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map((item) => toSerializable(item));

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
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        toSerializable(nested),
      ]),
    );
  }

  return String(value);
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

/**
 * Adapts Stellar Soroban RPC responses to the finality indexer's deterministic
 * ledger model. The RPC header supplies the parent hash used for fork checks.
 */
export class SorobanLedgerSource implements LedgerSource {
  constructor(private readonly rpc: SorobanRpcLedgerClient) {}

  async getLatestLedger(): Promise<{ sequence: number }> {
    return this.rpc.getLatestLedger();
  }

  async getLedger(sequence: number): Promise<LedgerSnapshot> {
    const response = await this.rpc.getLedgers({
      startLedger: sequence,
      pagination: { limit: 1 },
    });
    const ledger = response.ledgers.find((candidate) => candidate.sequence === sequence);
    if (!ledger) throw new Error(`Soroban RPC did not return ledger ${sequence}`);

    const previousHash =
      ledger.previousHash ?? previousHashFromHeader(ledger.headerXdr);
    if (sequence > 1 && !previousHash) {
      throw new Error(`Soroban RPC ledger ${sequence} did not include its parent hash`);
    }

    const eventResponse = await this.rpc.getEvents({
      filters: [],
      startLedger: sequence,
      endLedger: sequence,
    });

    return {
      sequence: ledger.sequence,
      hash: ledger.hash,
      previousHash,
      closedAt: ledger.ledgerCloseTime,
      events: toEvents(sequence, eventResponse.events),
    };
  }
}
