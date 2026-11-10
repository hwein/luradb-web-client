import { QueryClient, type QueryKey } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { SseEvent } from '../lib/sse'
import { DOMAINS_KEY } from './domains'
import { invalidateAllStoreQueries, invalidationTargetsFor, parseStoreEvent, type StoreEvent } from './storeEvents'
import { jsonIndexesQueryOptions, relTablesQueryOptions, relViewsQueryOptions } from './domainDetails'

// An die Quelle gebunden (spec shell/009 §2): eine Key-Umbenennung in domainDetails.ts macht diesen Test rot, nicht den Stream still.
const REL_TABLES_KEY = relTablesQueryOptions(undefined, 'probe', false).queryKey
const REL_VIEWS_KEY = relViewsQueryOptions(undefined, 'probe', false).queryKey
const JSON_INDEXES_KEY = jsonIndexesQueryOptions(undefined, 'probe', false).queryKey

function frame(data: string, event = 'table_created'): SseEvent {
  return { event, data, id: 'g-abc-1' }
}

describe('parseStoreEvent', () => {
  it('reads the JSON payload of a lifecycle frame', () => {
    const parsed = parseStoreEvent(frame('{"engine":"rel","type":"table_created","domain":"probe","object":"t1","ts":1788007646}'))

    expect(parsed).toEqual({ engine: 'rel', type: 'table_created', domain: 'probe', object: 't1', ts: 1788007646 })
  })

  it('reads a domain frame without an engine or object field', () => {
    expect(parseStoreEvent(frame('{"type":"domain_created","domain":"probe","ts":17}', 'domain_created'))).toEqual({
      type: 'domain_created',
      domain: 'probe',
      ts: 17,
    })
  })

  it.each([
    ['broken json', 'not json at all'],
    ['a json non-object', '"just a string"'],
    ['a missing domain', '{"engine":"rel","type":"table_created","ts":17}'],
    ['an unknown engine', '{"engine":"graph","type":"table_created","domain":"probe","ts":17}'],
  ])('returns undefined for %s — without throwing or logging', (_case, data) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseStoreEvent(frame(data))).toBeUndefined()

    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
    consoleError.mockRestore()
    consoleWarn.mockRestore()
  })
})

function event(engine: StoreEvent['engine'], type: string, object?: string): StoreEvent {
  return { ...(engine === undefined ? {} : { engine }), type, domain: 'probe', ...(object === undefined ? {} : { object }), ts: 17 }
}

describe('invalidationTargetsFor', () => {
  it('invalidates the domain list for a domain event without an engine field', () => {
    const parsed = parseStoreEvent(frame('{"type":"domain_created","domain":"probe","ts":17}', 'domain_created'))

    expect(parsed && invalidationTargetsFor(parsed)).toEqual([DOMAINS_KEY])
  })

  it.each<[string, StoreEvent, QueryKey[]]>([
    ['domain_deleted invalidates the domain list', event(undefined, 'domain_deleted'), [DOMAINS_KEY]],
    ['domain_purged invalidates the domain list', event(undefined, 'domain_purged'), [DOMAINS_KEY]],
    ['table_created invalidates the table list', event('rel', 'table_created', 't1'), [REL_TABLES_KEY]],
    ['table_dropped invalidates the table list', event('rel', 'table_dropped', 't1'), [REL_TABLES_KEY]],
    ['view_created invalidates the view list', event('rel', 'view_created', 'v1'), [REL_VIEWS_KEY]],
    ['view_dropped invalidates the view list', event('rel', 'view_dropped', 'v1'), [REL_VIEWS_KEY]],
    ['index_created (json) invalidates the json index list', event('json', 'index_created', 'field'), [JSON_INDEXES_KEY]],
    ['index_dropped (json) invalidates the json index list', event('json', 'index_dropped', 'field'), [JSON_INDEXES_KEY]],
    ['index_created (rel) has no consumer', event('rel', 'index_created', 'idx'), []],
    ['index_dropped (rel) has no consumer', event('rel', 'index_dropped', 'idx'), []],
    ['an unknown type invalidates nothing', event('rel', 'table_altered', 't1'), []],
    ['a data event invalidates nothing', event('kv', 'key_set', 'k1'), []],
  ])('%s', (_case, storeEvent, targets) => {
    expect(invalidationTargetsFor(storeEvent)).toEqual(targets)
  })
})

describe('invalidateAllStoreQueries', () => {
  it('invalidates the four explorer prefixes and nothing else', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateAllStoreQueries(queryClient)

    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      DOMAINS_KEY,
      ['rel-tables'],
      ['rel-views'],
      ['json-indexes'],
    ])
  })
})
