import { expect, test, type Page } from '@playwright/test'
import { dropDomain, readServerEnv } from './env'

const env = readServerEnv()
const DOMAIN = `e2e-${Date.now()}`
const KV_KEY = 'e2e-key'
const KV_VALUE = 'e2e-value'

/** CodeMirror-Flächen sind contenteditable — `fill()` greift dort nicht, es muss getippt werden. */
async function typeInEditor(page: Page, label: string, text: string): Promise<void> {
  const editor = page.getByLabel(label)
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await page.keyboard.type(text)
}

/** LuraSQL führt genau ein Statement je Run aus — kein `;`-Doppelstatement. */
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
  // Playwright hängt bei einem Request-Fehler das Call-Log inkl. Authorization-Header an — der Fehler darf den Report nie erreichen.
  const versionStatus = await request
    .get(`${env.url}/version`, { headers: { Authorization: `Bearer ${env.adminKey}` } })
    .then((response) => response.status())
    .catch(() => 0)
  expect(versionStatus, `LuraDB at ${env.url} must answer GET /version with 200 for the key in .env.local`).toBe(200)

  await page.goto('/')

  // --- Login: Verbindung anlegen, dann verbinden (zweistufiges Gate) ---
  await page.getByLabel('Name', { exact: true }).fill('e2e')
  await page.getByLabel('API Key', { exact: true }).fill(env.adminKey)
  // Ohne "Remember key" fragt der Connect-Dialog den Key ein zweites Mal ab.
  await page.getByLabel('Remember key').check()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'connect', exact: true }).click()

  await expect(page.getByRole('button', { name: 'connected' })).toBeVisible()
  await expect(page.getByText('localhost:5173 /store-api')).toBeVisible()
  await expect(page.getByText(/^luradb \d+\.\d+/)).toBeVisible()

  // --- Domäne anlegen (Explorer-Kaskade über kv/json/rel) und auswählen ---
  await page.getByRole('button', { name: '+ create domain' }).click()
  await page.getByLabel('domain name').fill(DOMAIN)
  await page.getByRole('button', { name: 'create', exact: true }).click()

  const domainRow = page.getByRole('button', { name: DOMAIN })
  await expect(domainRow).toBeVisible()
  await domainRow.click()
  await expect(page.getByRole('button', { name: 'new key' })).toBeVisible()

  // --- Query: LuraSQL-Konsole ---
  await page.getByRole('link', { name: 'LuraSQL console' }).click()

  await runSql(page, 'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)')
  await expect(page.getByText('ok · CREATE TABLE')).toBeVisible()

  await runSql(page, "INSERT INTO t (id, name) VALUES (1, 'x')")
  // Nur die Meta-Zeile trägt die Laufzeit — die Bestätigungszeile darunter nennt dieselbe Trefferzahl.
  await expect(page.getByText(/1 rows affected .+ ms/)).toBeVisible()

  await runSql(page, 'SELECT id, name FROM t')
  await expect(page.getByRole('cell', { name: '1', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'x', exact: true })).toBeVisible()

  // --- Browse: KV-Modus des Data Browsers ---
  await page.getByRole('button', { name: 'new key' }).click()
  await page.getByRole('button', { name: '+ new' }).click()
  await page.getByLabel('new key name').fill(KV_KEY)
  await typeInEditor(page, 'new key value editor', KV_VALUE)
  await page.getByRole('button', { name: 'create', exact: true }).click()

  await expect(page.getByText(`KEY ${KV_KEY}`)).toBeVisible()
  await expect(page.getByText(KV_VALUE, { exact: true })).toBeVisible()
})
