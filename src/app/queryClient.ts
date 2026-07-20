import { QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api'
import { disconnect } from './session'

/** Globaler 401-Handler: Key nicht mehr gültig ⇒ zurück ins Gate, Cache leeren. */
export function createAppQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) {
          disconnect()
          queryClient.clear()
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
