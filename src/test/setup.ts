import { afterAll, afterEach, beforeAll } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { server } from './msw'

// Multi-step query chains (explorer → detail → probe) exceed the 1 s default under full load: a flake source.
configure({ asyncUtilTimeout: 4000 })

// jsdom lacks Range.getClientRects; without it CodeMirror's measure loop throws, making tests flaky under load.
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
