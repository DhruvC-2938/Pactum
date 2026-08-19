export interface Reputation {
  address: string;
  trustScore: number;
  totalCommitments: number;
  fulfilledCommitments: number;
  lateCommitments: number;
  breachedCommitments: number;
  fulfillmentRate: number;
  updatedAt: string;
}

export interface ReputationRepository {
  findByAddress(address: string): Promise<Reputation | null>;
}
