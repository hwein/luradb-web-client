import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { dropDomain, readServerEnv } from './env'

const env = readServerEnv()
const STAMP = Date.now()
const DOMAINS = ['a', 'b', 'c', 'd'].map((suffix) => `e2e-${STAMP}-${suffix}`)
const USER = `e2e-user-${STAMP}`
const WIDTHS = [920, 1024, 1440]

let api: APIRequestContext

/** A request error would carry the Authorization header in Playwright's call log — report a generic text instead. */
async function expectOk(response: Promise<APIResponse>, what: string): Promise<void> {
  const result = await response.catch(() => undefined)
  expect(result?.ok(), `${what} on ${env.url} must succeed`).toBe(true)
}

test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext({
    baseURL: env.url,
    extraHTTPHeaders: { Authorization: `Bearer ${env.adminKey}` },
  })
  for (const name of DOMAINS) await expectOk(api.post('/store-api/domains', { data: { name } }), `create domain ${name}`)
  await expectOk(api.post('/store-api/auth/users', { data: { name: USER } }), `create user ${USER}`)
  for (const domain of DOMAINS) {
    await expectOk(api.post(`/store-api/auth/users/${USER}/permissions`, { data: { domain, access: 'write' } }), `grant ${domain}`)
  }
})

test.afterAll(async () => {
  await api.delete(`/store-api/auth/users/${USER}`).catch(() => undefined)
  for (const name of DOMAINS) await dropDomain(api, name)
  await api.dispose()
})

for (const width of WIDTHS) {
  test(`permission matrix keeps chips whole and columns aligned at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.getByLabel('Name', { exact: true }).fill('e2e')
    await page.getByLabel('API Key', { exact: true }).fill(env.adminKey)
    await page.getByLabel('Remember key').check()
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByRole('button', { name: 'connect', exact: true }).click()
    await expect(page.getByRole('button', { name: 'connected' })).toBeVisible()

    await page.getByRole('link', { name: 'Admin' }).click()
    for (const domain of DOMAINS) {
      await expect(page.getByRole('button', { name: `${USER} · ${domain}`, exact: true })).toBeVisible()
    }

    const cells = await page.locator('.admin-users__cell').evaluateAll((nodes) =>
      nodes.map((node) => ({ text: node.textContent ?? '', scrollWidth: node.scrollWidth, clientWidth: node.clientWidth })),
    )
    expect(cells.length).toBeGreaterThanOrEqual(DOMAINS.length * 4)
    for (const cell of cells) expect(cell.scrollWidth, `chip "${cell.text}" is cut off`).toBeLessThanOrEqual(cell.clientWidth)

    const heads = page.locator('.admin-users__col-domain--head')
    const names = await heads.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title')))
    const userColumns = page.locator('.admin-users__item', { hasText: USER }).locator('.admin-users__col-domain')
    for (const domain of DOMAINS) {
      const index = names.indexOf(domain)
      expect(index, `column head of ${domain}`).toBeGreaterThanOrEqual(0)
      const head = await heads.nth(index).boundingBox()
      const column = await userColumns.nth(index).boundingBox()
      expect(head, `head box of ${domain}`).not.toBeNull()
      expect(column, `column box of ${domain}`).not.toBeNull()
      expect(Math.abs((head?.x ?? 0) - (column?.x ?? 0)), `column ${domain} is offset from its head`).toBeLessThanOrEqual(1)
    }

    const tracks = await page
      .locator('.admin-users__row')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).gridTemplateColumns))
    expect(tracks.length, 'head and at least one user row').toBeGreaterThanOrEqual(2)
    const headTracks = tracks[0] ?? ''
    expect(headTracks.split(' '), 'head tracks: user, one per domain, actions').toHaveLength(names.length + 2)
    for (const rowTracks of tracks) expect(rowTracks, 'a row has other tracks than the head').toBe(headTracks)

    // After scrolling to the trash, the confirm line stays inside the visible part of the card.
    const scroll = page.locator('.admin-users__scroll')
    const userItem = page.locator('.admin-users__item', { hasText: USER })
    await scroll.evaluate((node) => {
      node.scrollLeft = node.scrollWidth
    })
    await userItem.getByTitle('delete user').click()
    const confirm = userItem.locator('.admin-users__confirm')
    const scrollBox = await scroll.boundingBox()
    const confirmBox = await confirm.boundingBox()
    expect(scrollBox, 'scroll box').not.toBeNull()
    expect(confirmBox, 'confirm box').not.toBeNull()
    expect(confirmBox?.x ?? 0, 'confirm line starts left of the visible card').toBeGreaterThanOrEqual((scrollBox?.x ?? 0) - 1)
    expect((confirmBox?.x ?? 0) + (confirmBox?.width ?? 0), 'confirm line ends right of the visible card').toBeLessThanOrEqual(
      (scrollBox?.x ?? 0) + (scrollBox?.width ?? 0) + 1,
    )
    await confirm.getByRole('button', { name: 'cancel' }).click()

    const pageOverflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
    expect(pageOverflow.scrollWidth).toBeLessThanOrEqual(pageOverflow.innerWidth)
  })
}
