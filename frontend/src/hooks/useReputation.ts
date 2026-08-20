import { useQuery } from '@tanstack/react-query';

import { fetchReputation } from '@/lib/api'
import { syncStore } from '@/lib/crdt/store'
import { reputationKeys } from '@/lib/queryKeys'
import { fetchReputation } from '@/lib/api';
import { reputationKeys } from '@/lib/queryKeys';

export function useReputation(address?: string) {
  return useQuery({
    queryKey: reputationKeys.detail(address ?? ''),
    queryFn: () => fetchReputation(address ?? ''),
    enabled: !!address,
    // Offline-first: render the persisted CRDT cache for known addresses.
    initialData: () => (address ? syncStore.readReputation(address) : undefined),
  })
}
  });
}
