import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

interface Sheet {
  file: string
  /** T2: rows with `min-height: var(--row-h)` and `border-radius: var(--rad)`. */
  rounded?: string[]
  /** T2: rows with `min-height` or `height` of `var(--row-h)`. */
  rows?: string[]
  /** T3: hover rule and selected rule that both carry `background: var(--panel2)`. */
  selected?: [string, string][]
}

const SHEETS: Sheet[] = [
  { file: 'src/app/ConnectionGate.css' },
  { file: 'src/screens/admin/AdminScreen.css' },
  { file: 'src/screens/admin/RestoreModal.css' },
  {
    file: 'src/screens/data/DataScreen.css',
    rounded: ['.json-list__row', '.kv-list__row'],
    rows: ['.json-list__head', '.kv-list__head', '.rel-list__head', '.rel-grid thead th', '.rel-grid tbody td'],
    selected: [
      ['.json-list__row:hover', '.json-list__row--selected'],
      ['.kv-list__row:hover', '.kv-list__row--selected'],
      ['.rel-grid tbody tr:hover', '.rel-grid__row--selected td'],
    ],
  },
  { file: 'src/screens/data/RelFileImportModal.css' },
  {
    file: 'src/screens/docs/DocsScreen.css',
    rounded: ['.docs__nav-item', '.docs__result'],
    selected: [['.docs__nav-item:hover', '.docs__nav-item--active']],
  },
  { file: 'src/screens/engines/EnginesScreen.css' },
  {
    file: 'src/screens/rest/RestScreen.css',
    rounded: ['.rest__endpoint'],
    selected: [['.rest__endpoint:hover', '.rest__endpoint--active']],
  },
  { file: 'src/screens/sql/AlterTableModal.css' },
  { file: 'src/screens/sql/CreateTableModal.css' },
  {
    file: 'src/screens/sql/SqlScreen.css',
    rows: ['.sql-grid thead th', '.sql-grid tbody td'],
    selected: [['.sql-grid tbody tr:hover', '.sql-grid__row--selected td']],
  },
  { file: 'src/shell/AboutModal.css' },
  {
    file: 'src/shell/CommandPalette.css',
    rounded: ['.cmdk__row'],
    selected: [['.cmdk__row:hover', '.cmdk__row--active']],
  },
  {
    file: 'src/shell/Explorer.css',
    rounded: ['.explorer__object-row', '.explorer__domain-row'],
    rows: ['.explorer__domain-header'],
    selected: [['.explorer__object-row:hover', '.explorer__object-row--selected']],
  },
  { file: 'src/shell/Rail.css' },
  { file: 'src/shell/Statusbar.css' },
  { file: 'src/shell/WhatsNewModal.css' },
]

const EXCEPTIONS = [
  '.docs-article__link',
  '.rail__logo',
  '.sql-tab__close',
  '.docs__tab-label',
  '.docs__tab-close',
  '.sql-chip',
  '.data__idx-pill--toggle',
  '.explorer__create-actions button',
  '.connection-form__actions button',
]

interface Rule {
  selectors: string[]
  decls: { prop: string; value: string }[]
}

/** Splits a selector list at top-level commas; `:not(.a, .b)` stays whole. */
function splitSelectors(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of list) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.map((s) => s.trim().replace(/\s+/g, ' ')).filter((s) => s !== '')
}

function parse(css: string): Rule[] {
  const rules: Rule[] = []
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decls = (block[2] ?? '').split(';').flatMap((decl) => {
      const match = /^\s*([-a-z]+)\s*:\s*(.+?)\s*$/.exec(decl)
      return match?.[1] !== undefined && match[2] !== undefined ? [{ prop: match[1], value: match[2] }] : []
    })
    rules.push({ selectors: splitSelectors(block[1] ?? ''), decls })
  }
  return rules
}

/** Every declaration of `selector` across the rules that list it. */
function declsOf(rules: Rule[], selector: string): { prop: string; value: string }[] {
  return rules.filter((r) => r.selectors.includes(selector)).flatMap((r) => r.decls)
}

function declares(rules: Rule[], selector: string, prop: string, value: string): boolean {
  return declsOf(rules, selector).some((d) => d.prop === prop && d.value === value)
}

function hasRestingSurface(rules: Rule[], selector: string): boolean {
  return declsOf(rules, selector).some(
    ({ prop, value }) =>
      ((prop === 'background' || prop === 'background-color') && value !== 'none' && value !== 'transparent') ||
      (prop === 'border' && value !== 'none' && !value.includes('transparent')),
  )
}

function hasHoverSurface(rules: Rule[], selector: string): boolean {
  const hover = rules.some((r) =>
    r.selectors.some(
      (s) =>
        s.startsWith(`${selector}:`) &&
        s.includes(':hover') &&
        r.decls.some((d) => d.prop === 'background' && (d.value === 'var(--panel2)' || d.value === 'var(--panel)')),
    ),
  )
  const rounded =
    selector.endsWith(' tr') ||
    declsOf(rules, selector).some((d) => d.prop === 'border-radius' && d.value.includes('var(--rad'))
  return hover && rounded
}

/** Selectors of rules with `cursor: pointer` that show neither a resting nor a hover surface. */
function bareClickables(rules: Rule[]): string[] {
  return rules
    .filter((r) => r.decls.some((d) => d.prop === 'cursor' && d.value === 'pointer'))
    .flatMap((r) => r.selectors)
    .filter((s) => !EXCEPTIONS.includes(s) && !hasRestingSurface(rules, s) && !hasHoverSurface(rules, s))
}

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(full)
    return entry.name.endsWith('.css') ? [full] : []
  })
}

const root = process.cwd()
const read = (file: string) => readFileSync(resolve(root, file), 'utf-8')

describe('style contract', () => {
  for (const sheet of SHEETS) {
    const rules = parse(read(sheet.file))

    it(`${sheet.file}: every clickable rule has a resting or hover surface`, () => {
      expect(bareClickables(rules)).toEqual([])
    })

    if (sheet.rounded !== undefined || sheet.rows !== undefined) {
      it(`${sheet.file}: rows use the row height token, rounded rows use --rad`, () => {
        const failing = [
          ...(sheet.rounded ?? []).filter(
            (s) =>
              !declares(rules, s, 'min-height', 'var(--row-h)') || !declares(rules, s, 'border-radius', 'var(--rad)'),
          ),
          ...(sheet.rows ?? []).filter(
            (s) => !declares(rules, s, 'min-height', 'var(--row-h)') && !declares(rules, s, 'height', 'var(--row-h)'),
          ),
        ]
        expect(failing).toEqual([])
      })
    }

    if (sheet.selected !== undefined) {
      it(`${sheet.file}: the selected row keeps the hover surface`, () => {
        const failing = sheet.selected
          ?.flat()
          .filter((s) => !declares(rules, s, 'background', 'var(--panel2)'))
        expect(failing).toEqual([])
      })
    }
  }

  it('covers every stylesheet that declares cursor: pointer', () => {
    const clickable = cssFiles(resolve(root, 'src'))
      .map((full) => relative(root, full).replaceAll('\\', '/'))
      .filter((file) => /cursor:\s*pointer/.test(read(file)))
      .sort()
    expect(SHEETS.map((s) => s.file).sort()).toEqual(clickable)
  })

  it('reports a clickable rule without a surface', () => {
    expect(bareClickables(parse('.a { cursor: pointer; }'))).toEqual(['.a'])
    expect(bareClickables(parse('.a { cursor: pointer; background: var(--panel); }'))).toEqual([])
    expect(
      bareClickables(parse('.a { cursor: pointer; border-radius: var(--rad); } .a:hover { background: var(--panel2); }')),
    ).toEqual([])
    expect(bareClickables(parse('.a { cursor: pointer; } .a:hover { background: var(--panel2); }'))).toEqual(['.a'])
  })
})
