import { defineConfig } from '@playwright/test'

/** E2E-Happy-Path gegen die echte lokale Instanz (spec general/011) — bewusst nicht Teil von `npm test`/`npm run check`. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  // Ein Lauf umfasst Login, Domänen-Kaskade, drei SQL-Statements und einen KV-Roundtrip gegen den echten Server.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
})
