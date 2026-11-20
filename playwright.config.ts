import { defineConfig } from '@playwright/test'

/** E2E happy path against the real local instance; deliberately not part of `npm test`/`npm run check`. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  // One run covers login, domain cascade, three SQL statements and a KV round trip against the real server.
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
