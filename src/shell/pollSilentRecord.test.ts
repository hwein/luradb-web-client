import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { pollSilentRecord } from './pollSilentRecord'

describe('pollSilentRecord', () => {
  it('is false when the query key has no cached data yet (Erst-Load)', () => {
    const queryClient = new QueryClient()
    expect(pollSilentRecord({ client: queryClient, queryKey: ['probe'] })).toBe(false)
  })

  it('is true once the query key already holds data (Folge-Tick)', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['probe'], 'value')
    expect(pollSilentRecord({ client: queryClient, queryKey: ['probe'] })).toBe(true)
  })
})
