export interface LedgerEvent {
  id: string;
  type: string;
  payload: unknown;
}

export interface LedgerSnapshot {
  sequence: number;
  hash: string;
  previousHash: string | null;
  closedAt: string;
  events: LedgerEvent[];
}

export interface LedgerCheckpoint {
  sequence: number;
  hash: string;
}

export interface LedgerSource {
  getLatestLedger(): Promise<{ sequence: number }>;
  getLedger(sequence: number): Promise<LedgerSnapshot | null>;
}

export interface IndexerStore {
  getCheckpoint(): Promise<LedgerCheckpoint | null>;
  getLedger(sequence: number): Promise<LedgerSnapshot | null>;
  appendLedger(ledger: LedgerSnapshot): Promise<void>;
  rollbackTo(sequence: number): Promise<void>;
}
