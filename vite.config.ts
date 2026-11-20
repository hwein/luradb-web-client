import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

// Backend unreachable => 502 instead of Vite's generic 500 (the client tells "server unreachable" apart by status).
// For SSE additionally: flush headers immediately and end the browser response when the upstream drops.
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
        // http-proxy writes status/headers synchronously only after this event; earlier flushes go nowhere.
        process.nextTick(() => res.flushHeaders())
        // Without this the browser stream stays half-open after an upstream drop instead of reconnecting.
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
      // Names only, never versions (hardening invariant); the client's own version is deliberately visible.
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_DEPENDENCIES__: JSON.stringify(Object.keys(pkg.dependencies).sort()),
    },
    server: {
      // cargo locks artifacts in src-tauri/target; the watcher must never enter it (EBUSY crash in app:dev)
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
      // Parallel runs under memory pressure exceed the 5 s default.
      testTimeout: 15_000,
      // e2e/ belongs to Playwright (needs server + key); else Vitest would collect its *.spec.ts.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }
})
