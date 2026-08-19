import { ReputationCache } from '../cache/reputationCache';
import { LedgerSnapshot } from './types';

const STELLAR_ADDRESS = /\bG[A-Z2-7]{55}\b/g;

function collectAddresses(value: unknown, result: Set<string>): void {
  if (typeof value === 'string') {
    for (const address of value.match(STELLAR_ADDRESS) ?? []) result.add(address);
  } else if (Array.isArray(value)) {
    for (const item of value) collectAddresses(item, result);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>))
      collectAddresses(item, result);
  }
}

export function affectedReputationAddresses(ledger: LedgerSnapshot): string[] {
  const addresses = new Set<string>();
  for (const event of ledger.events) collectAddresses(event.payload, addresses);
  return [...addresses];
}

export class ReputationCacheProjector {
  constructor(private readonly cache: ReputationCache) {}

  async ledgerCommitted(ledger: LedgerSnapshot): Promise<void> {
    await Promise.all(
      affectedReputationAddresses(ledger).map((address) => this.cache.refresh(address)),
    );
  }
}
