import type { CommitmentFilters } from './api'

export const reputationKeys = {
  all: ['reputation'] as const,
  detail: (address: string) => ['reputation', address] as const,
}

export const commitmentKeys = {
  all: ['commitments'] as const,
  list: (filters: CommitmentFilters = {}) => ['commitments', filters] as const,
  detail: (id: number | string) => ['commitments', 'detail', String(id)] as const,
}