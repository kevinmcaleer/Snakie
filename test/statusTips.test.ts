import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  STATUS_TIPS,
  TIP_MAX_INTERVAL_MS,
  TIP_MIN_INTERVAL_MS,
  nextTipDelayMs,
  parseTipsYaml,
  pickTipIndex,
  shouldShowTip
} from '../src/renderer/src/components/status-tips'

/**
 * Status-bar discovery tips (issue #434): the hand-rolled flat-YAML parser
 * (checked for parity against the real `yaml` package on the shipped file),
 * the 5–10 minute rotation scheduling, the non-repeating random pick, and the
 * "tips always give way to real messages" gate.
 */

const TIPS_YAML_PATH = fileURLToPath(
  new URL('../src/renderer/src/components/status-tips.yaml', import.meta.url)
)

describe('parseTipsYaml', () => {
  it('parses a flat list of text/href items, skipping comments and blanks', () => {
    const src = [
      '# a comment',
      '',
      '- text: Plain tip',
      '- text: Linked tip',
      '  href: https://docs.snakie.org/tutorials/',
      '- text: "Quoted: tip"',
      "- text: 'Single ''quoted'' tip'"
    ].join('\n')
    expect(parseTipsYaml(src)).toEqual([
      { text: 'Plain tip' },
      { text: 'Linked tip', href: 'https://docs.snakie.org/tutorials/' },
      { text: 'Quoted: tip' },
      { text: "Single 'quoted' tip" }
    ])
  })

  it('ignores unknown keys and drops items without a text', () => {
    const src = ['- text: Good', '  weight: 3', '- href: https://docs.snakie.org/'].join('\n')
    expect(parseTipsYaml(src)).toEqual([{ text: 'Good' }])
  })

  it('reads the SHIPPED file identically to a full YAML parser', () => {
    // The tiny parser only supports the flat `- text:`/`href:` shape — this
    // parity check fails if anyone edits status-tips.yaml into a form the
    // runtime parser would silently misread.
    const raw = readFileSync(TIPS_YAML_PATH, 'utf-8')
    expect(parseTipsYaml(raw)).toEqual(parse(raw))
  })
})

describe('STATUS_TIPS (the shipped list)', () => {
  it('has a healthy number of tips', () => {
    expect(STATUS_TIPS.length).toBeGreaterThanOrEqual(20)
  })

  it('every tip is non-empty and does NOT bake in the 💡 (the renderer adds it)', () => {
    for (const tip of STATUS_TIPS) {
      expect(tip.text.trim().length).toBeGreaterThan(0)
      expect(tip.text.includes('💡')).toBe(false)
    }
  })

  it('links only point at Snakie sites, over https', () => {
    for (const tip of STATUS_TIPS) {
      if (tip.href === undefined) continue
      expect(
        tip.href.startsWith('https://docs.snakie.org/') || tip.href === 'https://app.snakie.org'
      ).toBe(true)
    }
  })
})

describe('nextTipDelayMs', () => {
  it('spans exactly the 5–10 minute window', () => {
    expect(nextTipDelayMs(() => 0)).toBe(TIP_MIN_INTERVAL_MS)
    expect(nextTipDelayMs(() => 1)).toBe(TIP_MAX_INTERVAL_MS)
    expect(TIP_MIN_INTERVAL_MS).toBe(5 * 60_000)
    expect(TIP_MAX_INTERVAL_MS).toBe(10 * 60_000)
  })

  it('stays inside the window for arbitrary randoms', () => {
    for (const r of [0.001, 0.25, 0.5, 0.75, 0.999]) {
      const d = nextTipDelayMs(() => r)
      expect(d).toBeGreaterThanOrEqual(TIP_MIN_INTERVAL_MS)
      expect(d).toBeLessThanOrEqual(TIP_MAX_INTERVAL_MS)
    }
  })
})

describe('pickTipIndex', () => {
  it('returns -1 for an empty list and 0 for a single tip (even repeating)', () => {
    expect(pickTipIndex(0, null)).toBe(-1)
    expect(pickTipIndex(1, null)).toBe(0)
    expect(pickTipIndex(1, 0)).toBe(0)
  })

  it('never repeats the previous tip when more than one exists', () => {
    for (let prev = 0; prev < 5; prev++) {
      for (const r of [0, 0.2, 0.4, 0.6, 0.8, 0.999]) {
        const i = pickTipIndex(5, prev, () => r)
        expect(i).not.toBe(prev)
        expect(i).toBeGreaterThanOrEqual(0)
        expect(i).toBeLessThan(5)
      }
    }
  })

  it('clamps a rand() of exactly 1 into range', () => {
    expect(pickTipIndex(5, null, () => 1)).toBe(4)
  })
})

describe('shouldShowTip — tips ALWAYS give way to real messages', () => {
  const base = { enabled: true, liveWarning: false, hasPluginMessage: false }

  it('shows only when enabled and the bar is otherwise empty', () => {
    expect(shouldShowTip(base)).toBe(true)
  })

  it('is suppressed by the settings toggle', () => {
    expect(shouldShowTip({ ...base, enabled: false })).toBe(false)
  })

  it('yields to the live-poll warning', () => {
    expect(shouldShowTip({ ...base, liveWarning: true })).toBe(false)
  })

  it('yields to a plugin status message', () => {
    expect(shouldShowTip({ ...base, hasPluginMessage: true })).toBe(false)
  })

  it('never shows when anything real is up, even combined', () => {
    expect(shouldShowTip({ enabled: true, liveWarning: true, hasPluginMessage: true })).toBe(false)
  })
})
