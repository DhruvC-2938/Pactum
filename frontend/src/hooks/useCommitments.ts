import { useQuery } from '@tanstack/react-query'

import type { CommitmentFilters } from '@/lib/api'
import { fetchCommitments } from '@/lib/api'
import { commitmentKeys } from '@/lib/queryKeys'

export function useCommitments(filters: CommitmentFilters = {}) {
  return useQuery({
    queryKey: commitmentKeys.list(filters),
    queryFn: () => fetchCommitments(filters),
  })
}