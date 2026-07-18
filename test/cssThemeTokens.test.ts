import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'

/**
 * Theme-token guardrail (light/dark parity).
 * =============================================================================
 * Every `var(--token)` reference in the renderer must resolve to a custom
 * property that is actually DEFINED — either declared in CSS (`--token:`) or set
 * at runtime from TS/TSX (`setProperty('--token', …)` / a `'--token':` style
 * key). A reference to an UNDEFINED token silently falls back to whatever literal
 * was hardcoded in `var(--token, FALLBACK)` — and a hardcoded fallback only ever
 * looks right in ONE theme, so it reads as unreadable text/invisible chrome in
 * the other (this is exactly what bit the tutorials UI: `var(--fg, #e6edf3)` — a
 * near-white fallback — on the light parchment theme, because `--fg` was never a
 * real token; the real token is `--text`).
 *
 * This test enumerates the whole renderer and fails if any referenced token is
 * neither defined nor an explicitly-blessed override hook (see ALLOWED_UNDEFINED).
 */

const RENDERER = resolve(__dirname, '../src/renderer/src')

/**
 * Intentional, optional override hooks: tokens that are DELIBERATELY left
 * undefined so a theme/skin CAN set them, and whose `var(--x, FALLBACK)` fallback
 * ALREADY adapts to both themes (the fallback is itself a `var()` chain to a
 * defined token, or is theme-neutral — a translucent rgba / currentColor).
 * Anything added here must have such a safe fallback; a bare or hardcoded-opaque
 * fallback is a bug, not a hook. Keep this list SMALL and commented.
 */
const ALLOWED_UNDEFINED = new Set<string>([
  // Board-canvas material hooks: fallbacks are theme-neutral by design.
  '--bc-grid', // stroke on SVG pin-pitch grid; fallback #ffffff30 is a translucent white overlay
  '--bc-mat', //  PCB substrate/drill colour; fallbacks chain to var(--bg-sunken) or a literal dark PCB colour
  // Paper input material: cream fallback (#fbf7ec) is deliberately paired with a
  // hardcoded dark input text colour (#2a2c30), so the field reads as paper with
  // dark ink in BOTH themes. Renaming the background to a theme surface would put
  // dark text on a dark surface in the dark theme — so this is a hook, not a bug.
  '--paper',
])

/** Walk a dir tree, returning absolute paths of files with the given extensions. */
function walk(dir: string, exts: Set<string>): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p, exts))
    else if (exts.has(extname(p))) out.push(p)
  }
  return out
}

describe('CSS theme-token parity', () => {
  const cssFiles = walk(RENDERER, new Set(['.css']))
  const codeFiles = walk(RENDERER, new Set(['.ts', '.tsx']))

  const defined = new Set<string>()
  const referenced = new Map<string, string[]>() // token -> ["file:line", …]

  // --- collect DEFINITIONS ---------------------------------------------------
  for (const f of cssFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(?<![\w-])(--[a-zA-Z0-9-]+)\s*:/g)) {
      defined.add(m[1])
    }
  }
  for (const f of codeFiles) {
    const txt = readFileSync(f, 'utf8')
    // set at runtime: element.style.setProperty('--x', …)
    for (const m of txt.matchAll(/setProperty\(\s*['"`](--[a-zA-Z0-9-]+)['"`]/g)) defined.add(m[1])
    // React style object key: { '--x': … }
    for (const m of txt.matchAll(/['"`](--[a-zA-Z0-9-]+)['"`]\s*:/g)) defined.add(m[1])
  }

  // --- collect REFERENCES ----------------------------------------------------
  for (const f of [...cssFiles, ...codeFiles]) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        const rel = f.slice(f.indexOf('src/renderer/src'))
        const at = referenced.get(m[1]) ?? []
        at.push(`${rel}:${i + 1}`)
        referenced.set(m[1], at)
      }
    })
  }

  it('every referenced --token is defined (or a blessed override hook)', () => {
    const orphans: string[] = []
    for (const [tok, locs] of referenced) {
      if (defined.has(tok) || ALLOWED_UNDEFINED.has(tok)) continue
      orphans.push(`  ${tok}  →  ${locs.slice(0, 6).join(', ')}${locs.length > 6 ? ' …' : ''}`)
    }
    expect(
      orphans.length,
      `Undefined CSS custom properties are referenced (their hardcoded fallbacks break one theme).\n` +
        `Rename each to a real theme token (--bg/--bg-elevated/--bg-sunken/--text/--text-muted/--border/` +
        `--accent/--accent-ink/--accent-contrast/--danger/--warn/--success), define it, or — only if it is a ` +
        `deliberate override hook with a theme-safe fallback — add it to ALLOWED_UNDEFINED:\n` +
        orphans.join('\n')
    ).toBe(0)
  })
})
