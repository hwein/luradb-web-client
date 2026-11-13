import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Exception {
  file: string
  selector: string
  value: string
}

const EXCEPTIONS: Exception[] = [
  { file: 'src/app/ConnectionGate.css', selector: '.connection-gate__wordmark', value: '64px' },
  { file: 'src/screens/engines/EnginesScreen.css', selector: '.engines__card-ops', value: '26px' },
  { file: 'src/screens/docs/DocsScreen.css', selector: '.docs__title', value: '22px' },
  { file: 'src/screens/docs/DocsScreen.css', selector: '.docs-article :not(pre) > code', value: '0.85em' },
  { file: 'src/shell/TitleBar.css', selector: '.titlebar__name', value: '12px' },
]

const TOKEN = /^var\(--fs-(label|meta|data|body|title)\)$/

interface FontSize {
  selector: string
  value: string
}

interface Declaration extends FontSize {
  prop: 'font-size' | 'font'
}

function declarations(css: string): Declaration[] {
  const found: Declaration[] = []
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (block[1] ?? '').trim().replace(/\s+/g, ' ')
    for (const decl of (block[2] ?? '').split(';')) {
      const match = /^\s*(font-size|font)\s*:\s*(.+?)\s*$/.exec(decl)
      if (match?.[1] !== undefined && match[2] !== undefined) {
        found.push({ selector, prop: match[1] as Declaration['prop'], value: match[2] })
      }
    }
  }
  return found
}

function fontSizes(css: string): FontSize[] {
  return declarations(css)
    .filter((d) => d.prop === 'font-size')
    .map(({ selector, value }) => ({ selector, value }))
}

/** Violations of the typography rules in one source file; `path` is relative to the project root, with `/`. */
function findViolations(path: string, content: string): string[] {
  if (path.endsWith('.css')) {
    return declarations(content)
      .filter(({ selector, prop, value }) =>
        prop === 'font'
          ? value !== 'inherit'
          : value !== 'inherit' &&
            !TOKEN.test(value) &&
            !EXCEPTIONS.some((e) => e.file === path && e.selector === selector && e.value === value),
      )
      .map(({ selector, prop, value }) => `${path}: ${selector} { ${prop}: ${value} }`)
  }
  return content
    .split('\n')
    .flatMap((line, i) =>
      /(?:(?:fontSize|['"]font-size['"])\s*:|fontSize\s*=\s*\{?)\s*['"`]?[0-9.]/.test(line) ? [`${path}:${String(i + 1)}: ${line.trim()}`] : [],
    )
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(full) : [full]
  })
}

const root = process.cwd()

function files(match: (path: string) => boolean): { path: string; content: string }[] {
  return sourceFiles(resolve(root, 'src'))
    .map((full) => relative(root, full).replaceAll('\\', '/'))
    .filter(match)
    .map((path) => ({ path, content: readFileSync(resolve(root, path), 'utf-8') }))
}

describe('typography scale', () => {
  it('allows font-size literals in stylesheets only for the documented exceptions', () => {
    const sheets = files((p) => p.endsWith('.css'))
    expect(sheets.flatMap(({ path, content }) => findViolations(path, content))).toEqual([])
    for (const e of EXCEPTIONS) {
      const sheet = sheets.find((s) => s.path === e.file)
      expect(sheet && fontSizes(sheet.content), `${e.file} ${e.selector}`).toContainEqual({
        selector: e.selector,
        value: e.value,
      })
    }
  })

  it('reports a font-size literal outside the exceptions', () => {
    expect(findViolations('src/x.css', '.x { font-size: 12px; }')).toHaveLength(1)
    expect(findViolations('src/x.css', '.x { font-size: var(--fs-data); }\n.y { font-size: inherit; }')).toEqual([])
    expect(findViolations('src/x.css', '.x { font: 600 12px/1.5 var(--font-mono); }')).toHaveLength(1)
    expect(findViolations('src/x.css', '.x { font: inherit; }')).toEqual([])
  })

  it('allows no fontSize literals in TypeScript sources', () => {
    const sources = files((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p))
    expect(sources.flatMap(({ path, content }) => findViolations(path, content))).toEqual([])
    expect(findViolations('src/x.ts', "const t = { fontSize: '13px' }")).toHaveLength(1)
    expect(findViolations('src/x.ts', "const t = { 'font-size': '13px' }")).toHaveLength(1)
    expect(findViolations('src/x.ts', "const t = { fontSize: 'var(--fs-body)' }")).toEqual([])
  })

  it('reports a fontSize literal passed as a JSX attribute', () => {
    expect(findViolations('src/x.tsx', '<text fontSize={12} />')).toHaveLength(1)
    expect(findViolations('src/x.tsx', '<text fontSize="12px" />')).toHaveLength(1)
    expect(findViolations('src/x.tsx', "<text fontSize={'12px'} />")).toHaveLength(1)
    expect(findViolations('src/x.tsx', '<text fontSize={size} />')).toEqual([])
    expect(findViolations('src/x.tsx', '<text fontSize="var(--fs-body)" />')).toEqual([])
  })
})
