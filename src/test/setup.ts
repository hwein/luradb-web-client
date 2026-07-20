import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { server } from './msw'

// Mehrstufige Query-Ketten (Explorer→Detail→Probe) reißen unter Volllast das 1s-Default-Timeout — Flake-Quelle.
configure({ asyncUtilTimeout: 4000 })

// jsdom kennt Range.getClientRects nicht — CodeMirrors Measure-Loop wirft sonst und macht Tests unter Last flaky.
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()

beforeAll(() => server.listen())
afterEach(() => {
  cleanup()
  server.resetHandlers()
  localStorage.clear()
  sessionStorage.clear()
})
afterAll(() => server.close())
