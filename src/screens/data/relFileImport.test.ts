import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { ApiError, createApi } from '../../api'
import { server } from '../../test/msw'
import { formatFromFileName, normalizeColumnName, pkCandidates, runFileImport, tableNameFromFileName } from './relFileImport'

const BASE_URL = 'http://127.0.0.1:3000'
const FROM_FILE = `${BASE_URL}/store-api/rel/shop/tables/from-file`

function makeApiClient() {
  return createApi({ baseUrl: BASE_URL, fetchImpl: fetch, getAuthHeader: () => 'Bearer test-key' })
}

const created = {
  table: 'people',
  columns: [{ name: '_row', type: 'INTEGER', primary_key: true }],
  imported: 2,
  failed: 0,
  errors: [],
}

function normalizeHeader(line: string): string[] {
  const seen = new Set<string>()
  return line.split(',').map((field, index) => normalizeColumnName(field, index, seen))
}

describe('relFileImport', () => {
  it('formatFromFileName maps .tsv and .tab to tsv and everything else to csv', () => {
    expect(formatFromFileName('data.tsv')).toBe('tsv')
    expect(formatFromFileName('data.tab')).toBe('tsv')
    expect(formatFromFileName('DATA.TSV')).toBe('tsv')
    expect(formatFromFileName('data.csv')).toBe('csv')
    expect(formatFromFileName('data.txt')).toBe('csv')
    expect(formatFromFileName('data')).toBe('csv')
  })

  it('tableNameFromFileName lowercases, replaces invalid characters, prefixes a leading digit with t_, truncates to 50 and falls back to imported_table', () => {
    expect(tableNameFromFileName('People.csv')).toBe('people')
    expect(tableNameFromFileName('Order Export-2026.csv')).toBe('order_export_2026')
    expect(tableNameFromFileName('2026 sales.tsv')).toBe('t_2026_sales')
    expect(tableNameFromFileName(`${'a'.repeat(60)}.csv`)).toBe('a'.repeat(50))
    expect(tableNameFromFileName('.csv')).toBe('imported_table')
  })

  it('normalizeColumnName reproduces the measured server cases', () => {
    expect(normalizeHeader('First Name,created-at,Order#,id,ID,123abc,,select')).toEqual([
      'first_name',
      'created_at',
      'order_',
      'id',
      'id_2',
      'c123abc',
      'col_7',
      'select_',
    ])
    expect(normalizeHeader('Größe,😀x,İD,naïve name')).toEqual(['gr__e', '_x', 'i_d', 'na_ve_name'])
  })

  it('normalizeColumnName reproduces the example of the contract', () => {
    expect(normalizeHeader('SKU,Product Name,2024 Price,,sku,Order')).toEqual([
      'sku',
      'product_name',
      'c2024_price',
      'col_4',
      'sku_2',
      'order_',
    ])
  })

  it('normalizeColumnName truncates to 50 characters and keeps a duplicate suffix within the limit', () => {
    const long = 'a'.repeat(60)
    const seen = new Set<string>()
    expect(normalizeColumnName(long, 0, seen)).toBe('a'.repeat(50))
    expect(normalizeColumnName(long, 1, seen)).toBe(`${'a'.repeat(48)}_2`)
    expect(normalizeColumnName(long, 2, seen)).toBe(`${'a'.repeat(48)}_3`)
    expect([...seen].every((name) => name.length <= 50)).toBe(true)
  })

  it('pkCandidates splits the first line at the format delimiter and normalizes each field', () => {
    expect(pkCandidates('First Name,id,ID\nAda,1,2\n', 'csv', true)).toEqual([
      { name: 'first_name', source: 'First Name' },
      { name: 'id', source: 'id' },
      { name: 'id_2', source: 'ID' },
    ])
    expect(pkCandidates('First Name\tid, x\nAda\t1\t2\n', 'tsv', true)).toEqual([
      { name: 'first_name', source: 'First Name' },
      { name: 'id__x', source: 'id, x' },
    ])
    expect(pkCandidates('', 'csv', true)).toEqual([])
  })

  it('pkCandidates returns col_1 … col_n when the first line is not a header', () => {
    expect(pkCandidates('1,a,true\n2,b,false\n', 'csv', false)).toEqual([
      { name: 'col_1', source: 'col_1' },
      { name: 'col_2', source: 'col_2' },
      { name: 'col_3', source: 'col_3' },
    ])
    expect(pkCandidates('1\ta\n', 'tsv', false)).toHaveLength(2)
  })

  it('pkCandidates ignores the carriage return of a CRLF line ending', () => {
    expect(pkCandidates('id,Name\r\n1,a\r\n', 'csv', true)).toEqual([
      { name: 'id', source: 'id' },
      { name: 'name', source: 'Name' },
    ])
  })

  it('runFileImport posts the raw text to tables/from-file with name, format and header, and omits pk when none is chosen', async () => {
    let search = ''
    let body = ''
    server.use(
      http.post(FROM_FILE, async ({ request }) => {
        search = new URL(request.url).search
        body = await request.text()
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    const text = 'id,name\n1,Ada\n2,Bob\n'
    const result = await runFileImport(makeApiClient(), 'shop', { text, name: 'people', format: 'csv', header: true })
    expect(search).toBe('?name=people&format=csv&header=true')
    expect(body).toBe(text)
    expect(result).toEqual(created)
  })

  it('runFileImport adds pk to the query string when a column is chosen', async () => {
    let search = ''
    server.use(
      http.post(FROM_FILE, ({ request }) => {
        search = new URL(request.url).search
        return HttpResponse.json(created, { status: 201 })
      }),
    )
    await runFileImport(makeApiClient(), 'shop', { text: '1\ta\n', name: 'people', format: 'tsv', header: false, pk: 'col_1' })
    expect(search).toBe('?name=people&format=tsv&header=false&pk=col_1')
  })

  it('runFileImport throws an ApiError with the status and the original server text on a non-2xx response', async () => {
    const text = "invalid schema: pk column 'first name' not found"
    server.use(http.post(FROM_FILE, () => new HttpResponse(text, { status: 400, headers: { 'Content-Type': 'text/plain' } })))
    const error: unknown = await runFileImport(makeApiClient(), 'shop', {
      text: 'a\n1\n',
      name: 'people',
      format: 'csv',
      header: true,
      pk: 'first name',
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe(text)
  })

  it('runFileImport rejects a 201 body that is not a CreateFromFileResponse', async () => {
    server.use(http.post(FROM_FILE, () => HttpResponse.json({ table: 'people', imported: 1 }, { status: 201 })))
    const error: unknown = await runFileImport(makeApiClient(), 'shop', {
      text: 'a\n1\n',
      name: 'people',
      format: 'csv',
      header: true,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toBe('unexpected file import response shape')
  })
})
