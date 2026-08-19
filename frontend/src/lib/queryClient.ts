import { QueryClient } from '@tanstack/react-query'
import { OptimisticConflictEngine } from './optimisticEngine'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

/** Reconciles optimistic mutations against incoming Soroban chain events, per query key. */
export const conflictEngine = new OptimisticConflictEngine(queryClient)