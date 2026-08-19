import { useQuery } from '@tanstack/react-query';

import type { CommitmentFilters } from '@/lib/api'
import { fetchCommitments } from '@/lib/api'
import { syncStore } from '@/lib/crdt/store'
import { commitmentKeys } from '@/lib/queryKeys'
import type { CommitmentFilters } from '@/lib/api';
import { fetchCommitments } from '@/lib/api';
import { commitmentKeys } from '@/lib/queryKeys';

export function useCommitments(filters: CommitmentFilters = {}) {
  return useQuery({
    queryKey: commitmentKeys.list(filters),
    queryFn: () => fetchCommitments(filters),
    // Offline-first: render the persisted CRDT cache while a fresh fetch is
    // in flight or when the device is offline.
    initialData: () => {
      const cached = syncStore.readCommitments()
      return cached.length > 0 ? cached : undefined
    },
  })
}
  });
}
