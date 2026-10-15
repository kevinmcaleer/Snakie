#!/usr/bin/env node
// Design-system audit for the Snakie renderer (epic: light/dark parity + design system).
//
// Pass 1 of the design-system work: MEASURE what exists before deciding anything.
// Dependency-free so it runs on a fresh clone. Scans src/renderer/src for:
//
//   - every custom property (token) and where it is defined, per theme
//     (shared `:root`, dark = `:root` / `[data-theme='dark']`, light = `[data-theme='skeuomorph']`)
//   - tokens that only exist in ONE theme, and colour tokens that are identical in both
//   - theme-scoped rules: which files override for light, for dark, or only one of them
//   - raw colour literals outside token definitions (CSS and TS/TSX), by file and property
//   - `var(--x, <literal colour>)` fallbacks (a literal only ever suits one theme)
//   - raw typography / spacing / radius / shadow / z-index values
//   - class-name and button-variant sprawl, React component count
//
// Usage: node scripts/token-audit.mjs [--json]
// Writes docs/design/token-audit-data.json and prints a short summary.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { join, relative, extname, basename } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const RENDERER = join(ROOT, 'src/renderer/src')
const OUT_DIR = join(ROOT, 'docs/design')

function walk(dir, exts) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p, exts))
    else if (exts.has(extname(p))) out.push(p)
  }
  return out
}

const rel = (p) => relative(ROOT, p)

// --- CSS parsing ------------------------------------------------------------
// Brace-depth parser: yields { selector, body, at, line } for every style rule,
// recursing into @media/@supports. Good enough for hand-authored CSS.
function parseRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const rules = []
  function parseBlock(start, end, at) {
    let i = start
    let preludeStart = i
    while (i < end) {
      const c = clean[i]
      if (c === '{') {
        const prelude = clean.slice(preludeStart, i).trim()
        // find matching brace
        let depth = 1
        let j = i + 1
        while (j < end && depth > 0) {
          if (clean[j] === '{') depth++
          else if (clean[j] === '}') depth--
          j++
        }
        const bodyStart = i + 1
        const bodyEnd = j - 1
        const line = clean.slice(0, preludeStart).split('\n').length
        if (prelude.startsWith('@')) {
          if (/^@(media|supports|layer|container)/.test(prelude)) parseBlock(bodyStart, bodyEnd, [...at, prelude])
          // @keyframes, @font-face: skip
        } else {
          rules.push({ selector: prelude.replace(/\s+/g, ' '), body: clean.slice(bodyStart, bodyEnd), at, line })
        }
        i = j
        preludeStart = i
        continue
      }
      if (c === ';' || c === '}') preludeStart = i + 1
      i++
    }
  }
  parseBlock(0, clean.length, [])
  return rules
}

function declarations(body) {
  const out = []
  for (const part of body.split(';')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const prop = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (prop && value && !prop.includes('{')) out.push({ prop, value })
  }
  return out
}

// Which theme a selector applies to.
function themeOf(selector) {
  const sky = /data-theme=['"]?skeuomorph/.test(selector)
  const dark = /data-theme=['"]?dark/.test(selector)
  const bareRoot = selector.split(',').some((s) => s.trim() === ':root' || s.trim() === 'html')
  if (sky && !dark) return 'light'
  if (dark && !sky) return bareRoot ? 'dark-default' : 'dark'
  if (sky && dark) return 'both-scoped'
  return 'unscoped'
}

const COLOUR_RE = /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{4}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g
const NAMED_COLOURS = /\b(white|black|red|green|blue|yellow|orange|grey|gray|silver|gold|purple|pink)\b/i

function normColour(c) {
  c = c.toLowerCase().replace(/\s+/g, '')
  if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + [...c.slice(1)].map((x) => x + x).join('')
  return c
}

// --- collect ----------------------------------------------------------------
const cssFiles = walk(RENDERER, new Set(['.css']))
const codeFiles = walk(RENDERER, new Set(['.ts', '.tsx']))

const tokens = new Map() // name -> { light, dark, shared, definedIn:Set, scopedOnly:[] }
const themeScopes = {} // file -> { light, dark, both, lightSelectors:Set, darkSelectors:Set }
const rawColours = [] // { file, line, prop, value, theme, selector }
const fallbacks = [] // { file, token, fallback }
const raw = { fontSize: {}, fontFamily: {}, fontWeight: {}, spacing: {}, radius: {}, shadow: {}, zIndex: {}, transition: {} }
const classNames = new Set()
let cssLines = 0

function bump(map, key, file) {
  map[key] ??= { count: 0, files: new Set() }
  map[key].count++
  map[key].files.add(file)
}

for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8')
  cssLines += css.split('\n').length
  const f = rel(file)
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    if (!/^\d/.test(m[1])) classNames.add(m[1])
  }
  themeScopes[f] = { light: 0, dark: 0, lightSelectors: new Set(), darkSelectors: new Set() }
  for (const rule of parseRules(css)) {
    const theme = themeOf(rule.selector)
    const ts = themeScopes[f]
    // strip the theme prefix to compare light vs dark coverage of the same target
    for (const sel of rule.selector.split(',')) {
      const t = themeOf(sel)
      const target = sel.replace(/:root\[data-theme=['"]?(skeuomorph|dark)['"]?\]|\[data-theme=['"]?(skeuomorph|dark)['"]?\]|html/g, '').trim() || ':root'
      if (t === 'light') { ts.light++; ts.lightSelectors.add(target) }
      if (t === 'dark' || t === 'dark-default') { ts.dark++; if (target !== ':root') ts.darkSelectors.add(target) }
    }
    for (const { prop, value } of declarations(rule.body)) {
      // token definitions
      if (prop.startsWith('--')) {
        const tk = tokens.get(prop) ?? { light: null, dark: null, shared: null, definedIn: new Set(), local: [] }
        tk.definedIn.add(f)
        const isRoot = rule.selector.split(',').every((s) => /^(:root|html)(\[data-theme=['"]?\w+['"]?\])?$/.test(s.trim()))
        if (!isRoot) tk.local.push({ selector: rule.selector, value, theme })
        else if (theme === 'light') tk.light = value
        else if (theme === 'dark' || theme === 'dark-default') tk.dark = value
        else if (theme === 'unscoped') tk.shared = tk.shared ?? value
        tokens.set(prop, tk)
        continue
      }
      // var() fallbacks with a literal colour
      for (const m of value.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*,\s*([^)]*?(?:\([^)]*\))?[^)]*)\)/g)) {
        const fb = m[2].trim()
        if (fb.match(COLOUR_RE) && !fb.startsWith('var(')) fallbacks.push({ file: f, token: m[1], fallback: fb, line: rule.line })
      }
      // raw colours (strip var(...) fallbacks first so they aren't double-counted)
      const stripped = value.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, '')
      const colours = stripped.match(COLOUR_RE) ?? []
      for (const c of colours) rawColours.push({ file: f, line: rule.line, prop, value: normColour(c), theme, selector: rule.selector })
      if (!colours.length && NAMED_COLOURS.test(stripped) && /color|background|border|fill|stroke|shadow|outline/.test(prop)) {
        const named = stripped.match(NAMED_COLOURS)[0].toLowerCase()
        rawColours.push({ file: f, line: rule.line, prop, value: named, theme, selector: rule.selector })
      }
      if (value.includes('var(')) continue // tokenised (or partly) — not a raw value
      if (prop === 'font-size') bump(raw.fontSize, value, f)
      else if (prop === 'font-family') bump(raw.fontFamily, value, f)
      else if (prop === 'font-weight') bump(raw.fontWeight, value, f)
      else if (/^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(prop)) for (const v of value.split(/\s+/)) { if (/^-?\d/.test(v) && v !== '0') bump(raw.spacing, v, f) }
      else if (/radius/.test(prop)) bump(raw.radius, value, f)
      else if (prop === 'box-shadow') bump(raw.shadow, value, f)
      else if (prop === 'z-index') bump(raw.zIndex, value, f)
      else if (prop === 'transition') bump(raw.transition, value, f)
    }
  }
}

// --- TS/TSX colour literals ---------------------------------------------------
const codeColours = [] // { file, count, distinct, themeAware }
let reactComponents = 0
for (const file of codeFiles) {
  const txt = readFileSync(file, 'utf8')
  if (file.endsWith('.tsx') && /export (default )?function [A-Z]|export const [A-Z]\w* *[:=]/.test(txt)) reactComponents++
  const hits = [...txt.matchAll(/['"`](#[0-9a-fA-F]{3,8}|rgba?\([^)'"`]*\))['"`]|0x[0-9a-fA-F]{6}\b/g)].map((m) => normColour(m[1] ?? m[0]))
  if (!hits.length) continue
  const themeAware = /skeuomorph|useTheme|data-theme|getComputedStyle|prefers-color-scheme/.test(txt)
  codeColours.push({ file: rel(file), count: hits.length, distinct: new Set(hits).size, themeAware })
}
codeColours.sort((a, b) => b.count - a.count)

// --- token parity -------------------------------------------------------------
const isColour = (v) => v && (COLOUR_RE.test(v) || /gradient/.test(v)) && ((COLOUR_RE.lastIndex = 0), true)
const tokenRows = []
for (const [name, t] of tokens) {
  const light = t.light ?? t.shared
  const dark = t.dark ?? t.shared
  tokenRows.push({ name, light: t.light, dark: t.dark, shared: t.shared, definedIn: [...t.definedIn], localOnly: !t.light && !t.dark && !t.shared })
}
const lightOnly = tokenRows.filter((t) => t.light && !t.dark && !t.shared)
const darkOnly = tokenRows.filter((t) => t.dark && !t.light && !t.shared)
const identical = tokenRows.filter((t) => t.light && t.dark && t.light === t.dark && isColour(t.light))
const sharedColour = tokenRows.filter((t) => t.shared && !t.light && !t.dark && isColour(t.shared))
const localOnly = tokenRows.filter((t) => t.localOnly)

// --- theme-scope asymmetry ------------------------------------------------------
const scopeRows = Object.entries(themeScopes)
  .map(([file, s]) => {
    const lightNotDark = [...s.lightSelectors].filter((x) => x !== ':root' && !s.darkSelectors.has(x))
    const darkNotLight = [...s.darkSelectors].filter((x) => !s.lightSelectors.has(x))
    return { file, lightRules: s.light, darkRules: s.dark, lightOnlyTargets: lightNotDark.length, darkOnlyTargets: darkNotLight.length, lightOnlyExamples: lightNotDark.slice(0, 6), darkOnlyExamples: darkNotLight.slice(0, 6) }
  })
  .filter((r) => r.lightRules || r.darkRules)
  .sort((a, b) => b.lightRules + b.darkRules - (a.lightRules + a.darkRules))

// --- raw colour roll-ups ----------------------------------------------------------
const byFile = {}
const byValue = {}
const byProp = {}
const byTheme = {}
for (const c of rawColours) {
  byFile[c.file] = (byFile[c.file] ?? 0) + 1
  byValue[c.value] = (byValue[c.value] ?? 0) + 1
  const p = c.prop.replace(/-(top|right|bottom|left|color|image)$/, '')
  byProp[p] = (byProp[p] ?? 0) + 1
  byTheme[c.theme] = (byTheme[c.theme] ?? 0) + 1
}
// colour literals in UNSCOPED rules that set text or fill: one value for both themes
const unscopedInk = rawColours.filter((c) => c.theme === 'unscoped' && /^(color|background|background-color|fill|stroke|border|border-color|outline)/.test(c.prop))
const unscopedByFile = {}
for (const c of unscopedInk) unscopedByFile[c.file] = (unscopedByFile[c.file] ?? 0) + 1

const top = (obj, n = 25) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n)
const topRaw = (obj, n = 20) => Object.entries(obj).map(([k, v]) => [k, v.count, v.files.size]).sort((a, b) => b[1] - a[1]).slice(0, n)

const buttonClasses = [...classNames].filter((c) => /(^|[-_])(btn|button)([-_]|$)|btn/.test(c)).sort()

// --- UI pattern sprawl --------------------------------------------------------------
// How many separate BEM blocks implement each recurring UI pattern. The count is
// the pass-2 build order: most copies first (docs/design/ui-inventory.md §2).
const classFiles = new Map()
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of css.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    if (/^\d/.test(m[1])) continue
    if (!classFiles.has(m[1])) classFiles.set(m[1], new Set())
    classFiles.get(m[1]).add(basename(file))
  }
}
const PATTERNS = {
  Button: /(^|__|-)(btn|button)(--|$|-)/,
  'Icon button': /icon-?btn|iconbtn|__icon$|tool-?btn/,
  'Close button': /close/,
  'Segmented control / toggle': /seg(ment)?($|__|-)|toggle(__|$)|switcher/,
  Tabs: /(^|__|-)tabs?($|__|--)/,
  'Panel / section header': /(__|-)(head|header)($|--)/,
  'Dialog / modal': /(modal|dialog|backdrop|overlay)($|__|--)/,
  'Badge / chip / pill / tag': /(badge|chip|pill|tag)($|__|--)/,
  'Empty state': /empty/,
  'Input / field': /(input|field|search)($|__|--)/,
  'Select / dropdown / picker': /(select|dropdown|picker)($|__|--)/,
  'Tooltip / popover / hint': /(tooltip|popover|hint|nudge)($|__|--)/,
  'Notice / banner / toast': /(notice|banner|toast|alert)($|__|--)/,
  Card: /(^|__|-)card($|__|--)/,
  'Tree row': /tree(__|$)/,
  'Checkbox / switch': /(checkbox|check|switch)($|__|--)/,
  'Slider / knob': /(slider|knob|range)($|__|--)/,
  'Collapse chevron / caret': /(chevron|caret)($|__|--)/,
}
const patterns = Object.entries(PATTERNS)
  .map(([name, re]) => {
    const hits = [...classFiles.keys()].filter((c) => re.test(c))
    const blocks = new Set(hits.map((c) => c.split('__')[0].split('--')[0]))
    const files = new Set(hits.flatMap((c) => [...classFiles.get(c)]))
    return { pattern: name, implementations: blocks.size, classes: hits.length, files: files.size }
  })
  .sort((a, b) => b.implementations - a.implementations)

const data = {
  generated: new Date().toISOString().slice(0, 10),
  scope: 'src/renderer/src',
  health: {
    cssFiles: cssFiles.length,
    cssLines,
    codeFiles: codeFiles.length,
    reactComponentFiles: reactComponents,
    classNames: classNames.size,
    buttonClassNames: buttonClasses.length,
  },
  tokens: {
    total: tokenRows.length,
    themed: tokenRows.filter((t) => t.light && t.dark).length,
    lightOnly: lightOnly.map((t) => ({ name: t.name, light: t.light, definedIn: t.definedIn })),
    darkOnly: darkOnly.map((t) => ({ name: t.name, dark: t.dark, definedIn: t.definedIn })),
    identicalColour: identical.map((t) => ({ name: t.name, value: t.light })),
    sharedColour: sharedColour.map((t) => ({ name: t.name, value: t.shared, definedIn: t.definedIn })),
    componentLocal: localOnly.length,
    rows: tokenRows,
  },
  themeScopes: scopeRows,
  rawColours: {
    total: rawColours.length,
    distinct: Object.keys(byValue).length,
    byTheme,
    byProperty: top(byProp, 15),
    topValues: top(byValue, 30),
    topFiles: top(byFile, 30),
    unscopedInkTotal: unscopedInk.length,
    unscopedInkTopFiles: top(unscopedByFile, 30),
  },
  literalFallbacks: { total: fallbacks.length, topTokens: top(fallbacks.reduce((a, f) => ((a[f.token] = (a[f.token] ?? 0) + 1), a), {}), 25), topFiles: top(fallbacks.reduce((a, f) => ((a[f.file] = (a[f.file] ?? 0) + 1), a), {}), 20) },
  codeColours: { total: codeColours.reduce((a, c) => a + c.count, 0), files: codeColours.length, notThemeAware: codeColours.filter((c) => !c.themeAware).length, topFiles: codeColours.slice(0, 30) },
  typography: { fontSizes: topRaw(raw.fontSize, 40), distinctFontSizes: Object.keys(raw.fontSize).length, fontFamilies: topRaw(raw.fontFamily, 20), fontWeights: topRaw(raw.fontWeight) },
  spacing: { distinct: Object.keys(raw.spacing).length, top: topRaw(raw.spacing, 40), offFourGrid: Object.keys(raw.spacing).filter((v) => /^-?\d+(\.\d+)?px$/.test(v) && parseFloat(v) % 4 !== 0).length },
  radius: { distinct: Object.keys(raw.radius).length, top: topRaw(raw.radius, 20) },
  shadow: { distinct: Object.keys(raw.shadow).length, top: topRaw(raw.shadow, 10) },
  zIndex: { distinct: Object.keys(raw.zIndex).length, top: topRaw(raw.zIndex, 25) },
  patterns,
  buttonClasses,
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'token-audit-data.json'), JSON.stringify(data, null, 2) + '\n')

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(data, null, 2))
} else {
  const h = data.health
  console.log(`CSS: ${h.cssFiles} files, ${h.cssLines} lines, ${h.classNames} class names (${h.buttonClassNames} button-ish)`)
  console.log(`Tokens: ${data.tokens.total} defined, ${data.tokens.themed} themed, ${lightOnly.length} light-only, ${darkOnly.length} dark-only, ${identical.length} identical colour, ${sharedColour.length} shared colour`)
  console.log(`Raw colours in CSS: ${data.rawColours.total} (${data.rawColours.distinct} distinct); in unscoped ink/fill rules: ${unscopedInk.length}`)
  console.log(`Literal var() fallbacks: ${fallbacks.length}; TS/TSX colour literals: ${data.codeColours.total} in ${data.codeColours.files} files (${data.codeColours.notThemeAware} not theme-aware)`)
  console.log(`Font sizes: ${data.typography.distinctFontSizes} distinct; spacing values: ${data.spacing.distinct} (${data.spacing.offFourGrid} px values off the 4px grid); radii: ${data.radius.distinct}; shadows: ${data.shadow.distinct}; z-index: ${data.zIndex.distinct}`)
  console.log(`Wrote ${rel(join(OUT_DIR, 'token-audit-data.json'))}`)
}
