import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * ONE LOOK IN BOTH DOCKS, BOTH SKINS (#720).
 *
 * The hierarchy panel is mounted in two docks whose chrome is nothing alike:
 * the board browser is an always-dark card (#181, dark in BOTH skins so it reads
 * over the blue board) and the Build dock is transparent over the 3-D stage,
 * which is parchment in the skeuomorph skin. "Make them look the same" is one
 * `color:` away from meaning "hardcode the browser's dark ink", which is exactly
 * how a panel ends up unreadable on parchment.
 *
 * So the panel's palette is TOKENS, and a host may only re-point those tokens.
 * These are the two ways that contract rots — a host adding a colour of its own,
 * or a hex literal creeping into the panel's rules — and neither is visible in a
 * unit test of the component, only in the stylesheet.
 */

const CSS = readFileSync(
  resolve(__dirname, '../src/renderer/src/components/HierarchyPanel.css'),
  'utf8'
)

/** `[selector, body]` for every rule in the file, comments stripped. */
function rules(css: string): Array<[string, string]> {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, sel, body]) => [sel.trim(), body] as [string, string]
  )
}

/** Declared property names in a rule body (`color`, `--uhier-ink`, …). */
const props = (body: string): string[] =>
  body
    .split(';')
    .map((d) => d.split(':')[0].trim())
    .filter(Boolean)

describe('HierarchyPanel.css — the palette is tokens, not per-dock colours', () => {
  it('the panel declares its whole palette itself, so a host never has to', () => {
    const base = rules(CSS).find(([sel]) => sel === '.uhier')
    expect(base, 'the `.uhier` base rule').toBeTruthy()
    for (const token of ['--uhier-ink', '--uhier-muted', '--uhier-warn', '--uhier-surface', '--uhier-edge']) {
      expect(props(base![1]), `${token} must have a default on .uhier`).toContain(token)
    }
  })

  it('a host may only re-point the tokens — never set a colour on the panel', () => {
    // Anything of the form `.<host> .uhier…`: the board browser today, whatever
    // dock comes next tomorrow.
    const hostScoped = rules(CSS).filter(([sel]) => /^\.(?!uhier)[\w-]+\s+\.uhier/.test(sel))
    expect(hostScoped.length, 'there is at least one host override to check').toBeGreaterThan(0)
    for (const [sel, body] of hostScoped) {
      const offenders = props(body).filter((p) => !p.startsWith('--uhier-'))
      expect(offenders, `${sel} sets ${offenders.join(', ')} instead of a --uhier-* token`).toEqual([])
    }
  })

  it('no hex literal anywhere — that is how a dark-only colour gets in', () => {
    // Neutral rgba (the grey hover wash, the guide line) is fine: it reads on
    // parchment and on dark chrome alike. A hex never does both.
    const hexes = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])
    expect(hexes).toEqual([])
  })
})
