#!/usr/bin/env node
// WCAG contrast check for Snakie's theme tokens, in BOTH skins.
//
// Reads the token values straight out of src/renderer/src/index.css and scores
// the text-on-surface pairings the app renders, for the light (`skeuomorph`) and
// dark skins side by side. The point is parity: a pairing that passes in one
// skin and fails in the other is the bug this audit is looking for.
//
// Usage:
//   node scripts/check-contrast.mjs          # table, exit 1 on any failure
//   node scripts/check-contrast.mjs --json   # machine-readable
//
// Thresholds (WCAG 2.2): 4.5:1 text, 3:1 large text / UI boundaries (1.4.11).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const CSS = readFileSync(join(ROOT, 'src/renderer/src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

// Collect `--token: value` from the root-level theme blocks only.
function block(selectorRe) {
  const out = {}
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim()
    if (!sel.split(',').every((s) => /^:root(\[data-theme=['"]?\w+['"]?\])?$/.test(s.trim()))) continue
    if (!selectorRe.test(sel)) continue
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim()
  }
  return out
}
const shared = block(/^:root$/)
const dark = { ...shared, ...block(/data-theme=['"]?dark/) }
const light = { ...dark, ...block(/data-theme=['"]?skeuomorph/) }
// `:root, :root[data-theme='dark']` blocks are dark-default; skeuomorph overrides them.

function parse(v) {
  v = v.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(v)
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16))
  m = /^#([0-9a-f]{6})/i.exec(v)
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
  if (v === '#fff') return [255, 255, 255]
  return null
}
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

// [foreground token, background token, threshold, what it is]
const PAIRS = [
  // legacy chrome tokens
  ['--text', '--bg', 4.5, 'body text on app background'],
  ['--text', '--bg-elevated', 4.5, 'body text on chrome'],
  ['--text', '--bg-sunken', 4.5, 'body text on recessed control'],
  ['--text-muted', '--bg', 4.5, 'muted text on app background'],
  ['--text-muted', '--bg-elevated', 4.5, 'muted text on chrome'],
  ['--text-muted', '--bg-sunken', 4.5, 'muted text on recessed control'],
  ['--accent-ink', '--bg', 4.5, 'brass link/label text'],
  ['--accent-ink', '--bg-elevated', 4.5, 'brass text on chrome'],
  ['--accent', '--bg-elevated', 4.5, 'raw --accent used as text on chrome'],
  ['--accent-contrast', '--accent', 4.5, 'text on accent fill'],
  ['--danger', '--bg', 4.5, 'error text'],
  ['--danger', '--bg-sunken', 4.5, 'error text on recessed control'],
  ['--success', '--bg', 4.5, 'success text'],
  ['--warn', '--bg', 4.5, 'warning text'],
  ['--border', '--bg', 3, 'control boundary (non-text)'],
  ['--border', '--bg-elevated', 3, 'control boundary on chrome (non-text)'],
  // Soft Shell tokens
  ['--head', '--panel', 4.5, 'heading on panel'],
  ['--txt2', '--panel', 4.5, 'secondary text on panel'],
  ['--txt3', '--panel', 4.5, 'tertiary text on panel'],
  ['--txt3', '--panel2', 4.5, 'tertiary text on panel2 (tracks, segments)'],
  ['--txt4', '--panel', 4.5, 'quaternary text on panel'],
  ['--txt5', '--gutter', 4.5, 'line numbers on gutter'],
  ['--txt2', '--card', 4.5, 'secondary text on card'],
  ['--txt3', '--card', 4.5, 'tertiary text on card'],
  ['--greentext', '--panel', 4.5, 'green text on panel'],
  ['--goldink', '--goldbg', 4.5, 'gold ink on gold wash'],
  ['--goldink', '--panel', 4.5, 'gold ink on panel'],
  ['--ongold', '--gold', 4.5, 'ink on solid gold'],
  ['--bptext', '--blueprint', 4.5, 'blueprint text'],
  ['--shellbd', '--panel', 3, 'panel border (non-text)'],
  ['--kw', '--editor', 4.5, 'syntax: keyword'],
  ['--str', '--editor', 4.5, 'syntax: string'],
  ['--num', '--editor', 4.5, 'syntax: number'],
  ['--com', '--editor', 4.5, 'syntax: comment'],
  ['--ident', '--editor', 4.5, 'syntax: identifier'],
]

const rows = PAIRS.map(([fg, bg, need, what]) => {
  const score = (t) => {
    const a = parse(t[fg] ?? '')
    const b = parse(t[bg] ?? '')
    return a && b ? Math.round(ratio(a, b) * 100) / 100 : null
  }
  const l = score(light)
  const d = score(dark)
  return { fg, bg, need, what, light: l, dark: d, lightPass: l === null || l >= need, darkPass: d === null || d >= need }
})

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2))
} else {
  const pad = (s, n) => String(s).padEnd(n)
  console.log(pad('pair', 30), pad('need', 5), pad('light', 8), pad('dark', 8), 'use')
  for (const r of rows) {
    const mark = (v, ok) => (v === null ? 'n/a' : `${v}${ok ? '' : ' ✗'}`)
    console.log(pad(`${r.fg} / ${r.bg}`, 30), pad(r.need, 5), pad(mark(r.light, r.lightPass), 8), pad(mark(r.dark, r.darkPass), 8), r.what)
  }
  const lf = rows.filter((r) => !r.lightPass).length
  const df = rows.filter((r) => !r.darkPass).length
  console.log(`\n${rows.length} pairings: light fails ${lf}, dark fails ${df}`)
  if (lf || df) process.exitCode = 1
}
