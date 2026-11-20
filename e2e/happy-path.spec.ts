import { expect, test, type Page } from '@playwright/test'
import { dropDomain, readServerEnv } from './env'

const env = readServerEnv()
const DOMAIN = `e2e-${Date.now()}`
const KV_KEY = 'e2e-key'
const KV_VALUE = 'e2e-value'

/** CodeMirror surfaces are contenteditable; `fill()` does not work there, so type the text. */
async function typeInEditor(page: Page, label: string, text: string): Promise<void> {
  const editor = page.getByLabel(label)
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await page.keyboard.type(text)
}

/** LuraSQL runs exactly one statement per run, no `;` double statement. */
async function runSql(page: Page, statement: string): Promise<void> {
  await typeInEditor(page, 'sql editor', statement)
  await page.getByRole('button', { name: 'Run' }).click()
}

test.afterAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({
    baseURL: env.url,
    extraHTTPHeaders: { Authorization: `Bearer ${env.adminKey}` },
  })
  await dropDomain(api, DOMAIN)
  await api.dispose()
})

test('login, create domain, run LuraSQL, browse KV', async ({ page, request }) => {
  // On a request error Playwright appends the call log including the Authorization header; the error must never reach the report.
  const versionStatus = await request
    .get(`${env.url}/version`, { headers: { Authorization: `Bearer ${env.adminKey}` } })
    .then((response) => response.status())
    .catch(() => 0)
  expect(versionStatus, `LuraDB at ${env.url} must answer GET /version with 200 for the key in .env.local`).toBe(200)

  await page.goto('/')

  await page.getByLabel('Name', { exact: true }).fill('e2e')
  await page.getByLabel('API Key', { exact: true }).fill(env.adminKey)
  // Without "Remember key" the connect dialog asks for the key again.
  await page.getByLabel('Remember key').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'connect', exact: true }).click()

  await expect(page.getByRole('button', { name: 'connected' })).toBeVisible()
  await expect(page.getByText('localhost:5173 /store-api')).toBeVisible()
  await expect(page.getByText(/^luradb \d+\.\d+/)).toBeVisible()

  await page.getByRole('button', { name: '+ create domain' }).click()
  await page.getByLabel('domain name').fill(DOMAIN)
  await page.getByRole('button', { name: 'create', exact: true }).click()

  const domainRow = page.getByRole('button', { name: DOMAIN })
  await expect(domainRow).toBeVisible()
  await domainRow.click()
  await expect(page.getByRole('button', { name: 'new key' })).toBeVisible()

  await page.getByRole('link', { name: 'LuraSQL console' }).click()

  await runSql(page, 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
  await expect(page.getByText('ok · CREATE TABLE')).toBeVisible()

  await runSql(page, "INSERT INTO t (id, name) VALUES (1, 'x')")
  // Only the meta line carries the duration; the confirmation line below states the same row count.
  await expect(page.getByText(/1 rows affected .+ ms/)).toBeVisible()

  await runSql(page, 'SELECT id, name FROM t')
  await expect(page.getByRole('cell', { name: '1', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'x', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'new key' }).click()
  await page.getByRole('button', { name: '+ new' }).click()
  await page.getByLabel('new key name').fill(KV_KEY)
  await typeInEditor(page, 'new key value editor', KV_VALUE)
  await page.getByRole('button', { name: 'create', exact: true }).click()

  await expect(page.getByText(`KEY ${KV_KEY}`)).toBeVisible()
  await expect(page.getByText(KV_VALUE, { exact: true })).toBeVisible()
})
