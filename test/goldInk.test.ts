import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Readable text on the gold controls (#956).
 *
 * `--goldink` means gold-COLOURED ink, for text on the dark chrome. It reads
 * like "the ink for gold", so it was used for both — and the gold SURFACES do
 * not flip with the skin:
 *
 *     --grad-gold  linear-gradient(#f0dca6, #e7bf62)   identical in both skins
 *     --gold       #d9a441                             identical in both skins
 *     --goldink    #f0dca6 (dark) / #6b4e17 (skeuo)    flips
 *
 * So on the dark skin it painted #f0dca6 on a gradient whose top stop IS
 * #f0dca6 — a contrast ratio of 1.00. The active Electronics tab, "+ New part"
 * and the Help pill were invisible in one skin and fine in the other.
 *
 * `--ongold` is the ink for those surfaces, defined once in the shared `:root`
 * because a value that must not differ between skins should not live somewhere
 * it could.
 */

function stylesheets(dir = 'src/renderer/src'): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...stylesheets(p))
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

/** Rules that paint a gold SURFACE, with whatever colour they set on it. */
function goldSurfaceRules(): { file: string; line: number; selector: string; color: string }[] {
  const out: { file: string; line: number; selector: string; color: string }[] = []
  for (const file of stylesheets()) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((l, i) => {
      const paintsGold = /background[^;]*var\(--(grad-gold|gold)\b/.test(l)
      if (!paintsGold) return
      let start = i
      while (start > 0 && !lines[start].includes('{')) start--
      let end = i
      while (end < lines.length - 1 && !lines[end].includes('}')) end++
      const body = lines.slice(start, end + 1)
      const colour = body.find((b) => /^\s*color:/.test(b))
      out.push({
        file,
        line: start + 1,
        selector: lines[start].split('{')[0].trim(),
        color: colour?.trim() ?? '(inherits)'
      })
    })
  }
  return out
}

describe('nothing paints gold ink on a gold surface', () => {
  it('no rule with a gold background sets --goldink', () => {
    const bad = goldSurfaceRules().filter((r) => r.color.includes('--goldink'))
    expect(
      bad.map((r) => `${r.file}:${r.line}  ${r.selector}  ${r.color}`),
      '--goldink is pale on the dark skin, and the gold surfaces are the same in both — use --ongold'
    ).toEqual([])
  })

  it('the gold controls actually use --ongold', () => {
    // Both directions: a later change that dropped the token would leave the
    // controls inheriting whatever, which is how this started.
    const users = goldSurfaceRules().filter((r) => r.color.includes('--ongold'))
    expect(users.length).toBeGreaterThan(8)
    expect(users.some((r) => r.file.includes('WorkspaceSwitcher'))).toBe(true)
    expect(users.some((r) => r.file.includes('PartsPanel'))).toBe(true)
  })
})

describe('the token is defined where it cannot diverge', () => {
  const css = readFileSync('src/renderer/src/index.css', 'utf8')

  it('lives in the shared :root, not once per skin', () => {
    // The surfaces it sits on are identical across skins, so its ink must be
    // too — defining it twice is an invitation for them to drift apart.
    const shared = css.slice(css.indexOf(':root {'), css.indexOf(":root[data-theme='dark']"))
    expect(shared).toContain('--ongold:')
    for (const skin of ['dark', 'skeuomorph']) {
      const at = css.indexOf(`:root[data-theme='${skin}'] {`)
      const block = css.slice(at, css.indexOf('\n}', at))
      expect(block, `${skin} must not redefine it`).not.toContain('--ongold:')
    }
  })

  it('is dark enough to read on both ends of the gradient', () => {
    const m = /--ongold:\s*(#[0-9a-f]{6})/i.exec(css)
    expect(m).toBeTruthy()
    const ratio = (a: string, b: string): number => {
      const lum = (h: string): number => {
        const v = [1, 3, 5].map((i) => {
          const c = parseInt(h.slice(i, i + 2), 16) / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
      }
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    // The gradient's two stops, and the solid gold.
    for (const bg of ['#f0dca6', '#e7bf62', '#d9a441']) {
      expect(ratio(m![1], bg), `${m![1]} on ${bg}`).toBeGreaterThan(4.5)
    }
  })
})

describe('--goldink keeps the job it was named for', () => {
  it('is still used for gold text on dark surfaces', () => {
    // The fix is a split, not a rename: gold-coloured text on the dark chrome
    // is exactly what this token is for, and those uses were never wrong.
    const remaining = stylesheets().filter((f) =>
      readFileSync(f, 'utf8').includes('var(--goldink')
    )
    expect(remaining.length).toBeGreaterThan(0)
  })
})
