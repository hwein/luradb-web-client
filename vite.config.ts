import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

// Backend nicht erreichbar ⇒ 502 statt Vites generischem 500 (general/004 unterscheidet "server unreachable" am Status).
function localServerProxy(): ProxyOptions {
  return {
    target: 'http://127.0.0.1:3000',
    configure(proxyServer) {
      proxyServer.on('error', (_err, _req, res) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('upstream unreachable')
      })
    },
  }
}

interface PackageJson {
  version: string
  dependencies: Record<string, string>
}

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as PackageJson

export default defineConfig({
  plugins: [react()],
  define: {
    // Nur Namen, nie Versionen (Härtungs-Invariante spec shell/005 §1) — die Client-Version selbst ist gewollt sichtbar.
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_DEPENDENCIES__: JSON.stringify(Object.keys(pkg.dependencies).sort()),
  },
  server: {
    // cargo sperrt Artefakte in src-tauri/target — der Watcher darf dort nie hinein (EBUSY-Crash bei app:dev)
    watch: { ignored: ['**/src-tauri/**'] },
    proxy: {
      '/store-api': localServerProxy(),
      '/health': localServerProxy(),
      '/version': localServerProxy(),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/ gehört Playwright (braucht Server + Key); Vitest würde die *.spec.ts sonst einsammeln.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
