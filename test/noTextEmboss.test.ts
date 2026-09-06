import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No letterpress on text (#960).
 *
 * The app was embossing its own type — `text-shadow: 0 1px 0 #fff` under dark
 * text on grey, and the dark-above inverse on the dark skin. At body size on a
 * settings dialog it reads as a blur: every glyph carries a white ghost a pixel
 * below it, which is the opposite of what a shadow is meant to do for contrast.
 *
 * WHAT IS NOT A LETTERPRESS. The instrument panels glow — `0 0 6px` in the
 * accent, on LED readouts, meters and scope traces. That is the panels' whole
 * look and nobody is trying to read a 0.7rem paragraph through it, so those
 * stay. The distinction this file draws is therefore between a shadow OFFSET
 * under the glyph and a halo AROUND it, which is exactly the distinction
 * between the effect that hurt and the one that was wanted.
 */

/** Every stylesheet the renderer ships. */
function stylesheets(dir = 'src/renderer/src'): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...stylesheets(p))
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

interface Shadow {
  file: string
  line: number
  value: string
}

function shadows(): Shadow[] {
  const found: Shadow[] = []
  for (const file of stylesheets()) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const m = /text-shadow:\s*([^;]+);/.exec(line)
        if (m) found.push({ file, line: i + 1, value: m[1].trim() })
      })
  }
  return found
}

/** A halo: no offset, just a blur radius. `0 0 6px …` */
const isGlow = (value: string): boolean => /^0\s+0\s+\d/.test(value)

describe('the app does not emboss its own text', () => {
  it('has no offset text-shadow left anywhere', () => {
    const offenders = shadows().filter((s) => s.value !== 'none' && !isGlow(s.value))
    expect(
      offenders.map((s) => `${s.file}:${s.line}  ${s.value}`),
      'text-shadow with an offset is the letterpress effect #960 removed — a glow (`0 0 Npx`) is fine'
    ).toEqual([])
  })

  it('kept the instrument glows, which are a different thing', () => {
    // A guard in both directions: a later sweep that deleted these would strip
    // the LED readouts, meters and scope traces of the look they exist to have.
    const glows = shadows().filter((s) => isGlow(s.value))
    expect(glows.length).toBeGreaterThan(30)
    expect(glows.some((s) => s.file.includes('Oscilloscope'))).toBe(true)
    expect(glows.some((s) => s.file.includes('Multimeter'))).toBe(true)
  })

  it('keeps only the `none` overrides that still turn something off', () => {
    // An override of a rule that no longer exists is dead code that reads as a
    // deliberate exception. Each remaining one must sit in a file that still
    // sets a glow.
    for (const s of shadows().filter((s) => s.value === 'none')) {
      const sameFile = shadows().filter((o) => o.file === s.file && isGlow(o.value))
      expect(sameFile.length, `${s.file}:${s.line} overrides nothing`).toBeGreaterThan(0)
    }
  })
})
