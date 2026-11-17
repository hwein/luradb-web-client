import { QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api'
import { disconnect } from './session'

/**
 * Ends the session and drops the cache filled under it; every trigger calls this, never the two steps apart.
 * disconnect() in session.ts cannot clear the cache itself: it has no QueryClient.
 */
export function endSession(queryClient: QueryClient): void {
  disconnect()
  queryClient.clear()
}

/** Global 401 handler: the key is no longer valid, so the session ends via endSession. */
export function createAppQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          endSession(queryClient)
        }
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  return queryClient
}
