import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

// Backend nicht erreichbar ⇒ 502 statt Vites generischem 500 (general/004 unterscheidet "server unreachable" am Status).
// Für SSE zusätzlich: Header sofort weiterreichen und die Browser-Response beenden, wenn der Upstream abreißt (spec general/015).
function localServerProxy(target: string): ProxyOptions {
  return {
    target,
    // Hosted targets route by Host header; the local path stays untouched.
    ...(target.startsWith('https://') && { changeOrigin: true }),
    configure(proxyServer) {
      proxyServer.on('error', (_err, _req, res) => {
        if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' })
        res.end('upstream unreachable')
      })
      proxyServer.on('proxyRes', (proxyRes, _req, res) => {
        if (proxyRes.headers['content-type']?.includes('text/event-stream') !== true) return
        // http-proxy schreibt Status/Header erst synchron nach diesem Event — sonst flushten wir ins Leere.
        process.nextTick(() => res.flushHeaders())
        // Ohne das bliebe der Browser-Stream nach einem Upstream-Abriss halboffen hängen statt zu reconnecten.
        const endResponse = (): void => void res.destroy()
        proxyRes.on('close', () => {
          if (!proxyRes.complete) endResponse()
        })
        proxyRes.on('error', endResponse)
      })
    },
  }
}

interface PackageJson {
  version: string
  dependencies: Record<string, string>
}

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as PackageJson

export default defineConfig(({ mode }) => {
  // Empty prefix loads unprefixed vars too; they reach this config only, never the bundle.
  const target = (loadEnv(mode, process.cwd(), '').LURADB_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  if (mode === 'development') console.info(`luradb proxy → ${target}`)
  return {
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
        '/store-api': localServerProxy(target),
        '/health': localServerProxy(target),
        '/version': localServerProxy(target),
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // e2e/ gehört Playwright (braucht Server + Key); Vitest würde die *.spec.ts sonst einsammeln.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }
})
