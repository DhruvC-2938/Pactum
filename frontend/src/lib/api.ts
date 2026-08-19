export type CommitmentStatus = 'Pending' | 'Fulfilled' | 'Late' | 'Breached';

export interface Reputation {
  address: string;
  fulfilled: number;
  late: number;
  breached: number;
  total: number;
}

export interface Commitment {
  id: number;
  issuer: string;
  counterparty: string;
  terms_hash: string;
  due_at: number;
  status: CommitmentStatus;
  outcome: CommitmentStatus | null;
}

export interface CommitmentFilters {
  status?: CommitmentStatus;
  address?: string;
  page?: number;
  limit?: number;
}

export interface ScoreData {
  score: number;
  fulfilledCount: number;
  lateCount: number;
  breachedCount: number;
  epoch: number;
  sourceLedgerSeq: number;
}

export interface PactumStateProof {
  version: string;
  networkPassphrase: string;
  ledgerSeq: number;
  ledgerHeaderHash: string;
  stateRootHash: string;
  contractId: string;
  stellarAddress: string;
  scoreData: ScoreData;
  leafHash: string;
  merkleProof: Array<{ sibling: string; isRight: boolean }>;
  headerProof: {
    previousLedgerHash: string;
    txSetResultHash: string;
    bucketListHash: string;
    ledgerVersion: number;
  };
}

interface StateProofResponse {
  success: true;
  proof: PactumStateProof;
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, options);

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

export function fetchReputation(address: string, signal?: AbortSignal): Promise<Reputation> {
  return request<Reputation>(`/reputation/${encodeURIComponent(address)}`, { signal });
}

export async function fetchReputationProof(
  address: string,
  signal?: AbortSignal,
): Promise<PactumStateProof> {
  const response = await request<StateProofResponse>(
    `/api/v1/proofs/trust-score/${encodeURIComponent(address)}`,
    { signal },
  );

  if (!response.success || !response.proof) {
    throw new Error('State proof response is missing its proof payload');
  }

  return response.proof;
}

export function fetchCommitments(
  filters: CommitmentFilters = {},
  signal?: AbortSignal,
): Promise<Commitment[]> {
  const params = new URLSearchParams();

  if (filters.status) params.set('status', filters.status);
  if (filters.address) params.set('address', filters.address);
  if (filters.page) params.set('page', filters.page.toString());
  if (filters.limit) params.set('limit', filters.limit.toString());

  const query = params.toString();
  return request<Commitment[]>(`/commitments${query ? `?${query}` : ''}`, { signal });
}
