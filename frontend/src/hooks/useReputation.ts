import { useQuery } from '@tanstack/react-query';

import { fetchReputation } from '@/lib/api';
import { reputationKeys } from '@/lib/queryKeys';

export function useReputation(address?: string) {
  return useQuery({
    queryKey: reputationKeys.detail(address ?? ''),
    queryFn: () => fetchReputation(address ?? ''),
    enabled: !!address,
  });
}
