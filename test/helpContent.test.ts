import { describe, it, expect } from 'vitest'
import {
  HELP_SECTIONS,
  detectProjectParts,
  dialectNote,
  helpTreeFor,
  type HelpNode
} from '../src/renderer/src/components/help-content'
import { HELP_ARTICLES } from '../src/renderer/src/components/help-articles'
import { INSTRUMENTS } from '../src/renderer/src/components/instruments-registry'
import { API_EQUIVALENTS, apiFor } from '../src/shared/dialect-api'
import type { Dialect } from '../src/shared/dialect'
import type { PartLibraryWithParts } from '../src/preload/index.d'

const find = (nodes: HelpNode[], id: string): HelpNode | undefined => {
  for (const n of nodes) {
    if (n.id === id) return n
    const f = n.children ? find(n.children, id) : undefined
    if (f) return f
  }
  return undefined
}

/** Every article id reachable in a tree. */
const articleIds = (nodes: HelpNode[]): string[] =>
  nodes.flatMap((n) => (n.children ? articleIds(n.children) : [n.id]))

describe('help tree', () => {
  it('has an article per registered instrument, and each has authored content', () => {
    const instruments = find(HELP_SECTIONS, 'instruments')!
    expect(instruments.children).toHaveLength(INSTRUMENTS.length)
    for (const d of INSTRUMENTS) {
      const node = find(HELP_SECTIONS, `inst-${d.id}`)
      expect(node, `article for ${d.id}`).toBeTruthy()
      expect((HELP_ARTICLES[`inst-${d.id}`] ?? '').length, `content for inst-${d.id}`).toBeGreaterThan(20)
    }
  })

  it('has Getting Started + Reference (Python/MicroPython/CircuitPython/Pinouts) with content', () => {
    for (const id of [
      'getting-started',
      'reference',
      'ref-python',
      'ref-micropython',
      'ref-circuitpython',
      'ref-pinouts'
    ]) {
      expect(find(HELP_SECTIONS, id), id).toBeTruthy()
    }
    for (const id of ['gs-connect', 'ref-i2c', 'ref-pwm', 'ref-pinout']) {
      expect((HELP_ARTICLES[id] ?? '').length, id).toBeGreaterThan(20)
    }
  })

  it('every article in the tree has a body, on every dialect', () => {
    for (const d of ['micropython', 'circuitpython', 'unknown'] as Dialect[]) {
      for (const id of articleIds(helpTreeFor(d))) {
        // Instrument + part pages are covered elsewhere; this catches a new
        // dialect page registered without its markdown.
        expect((HELP_ARTICLES[id] ?? '').length, `${id} (${d})`).toBeGreaterThan(200)
      }
    }
  })
})

/**
 * MINI HELP PER DIALECT (#763, epic #209).
 *
 * The issue's acceptance criterion is one sentence — "a CircuitPython user
 * reading the Help panel is never shown `machine.Pin`" — so these tests check
 * that as a property of the whole tree rather than page by page.
 */

/**
 * MicroPython-only APIs, as they appear in code (not in prose about them).
 *
 * `Pin(`/`ADC(`/`PWM(` are here because a snippet can teach `machine` without
 * ever naming it — a bare `led = Pin(15, Pin.OUT)` is just as unrunnable on a
 * CircuitPython board, and that is how two of these pages were written.
 */
const MICROPYTHON_ONLY = [
  /\bmachine\b/,
  /\bPin\(/,
  /\bPin\.[A-Z]/,
  /\bADC\(/,
  /\bPWM\(/,
  /\bsleep_ms\b/,
  /\bsleep_us\b/,
  /\bticks_(ms|us|cpu|diff|add)\b/,
  /\bduty_u16\b/,
  /\bread_u16\b/,
  /\buasyncio\b/,
  /\bmip\.install\b/
]

/** The ```python blocks in a markdown body — the code somebody will copy. */
function pythonBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1])
}

/** The MicroPython-only lines in an article's code, if any. */
function microPythonCode(articleId: string): string[] {
  const body = HELP_ARTICLES[articleId] ?? ''
  const lines = pythonBlocks(body).flatMap((b) => b.split('\n'))
  return lines.filter((line) => MICROPYTHON_ONLY.some((re) => re.test(line)))
}

describe('the CircuitPython help tree', () => {
  const cpTree = helpTreeFor('circuitpython')
  const mpTree = helpTreeFor('micropython')

  it('drops the MicroPython pages and adds the CircuitPython ones', () => {
    const cp = articleIds(cpTree)
    // The four pages a beginner reaches first, and the ones that replace them.
    for (const id of ['ref-pins', 'ref-timing', 'ref-i2c', 'ref-pwm', 'gs-packages', 'gs-run']) {
      expect(cp, `${id} still offered to CircuitPython`).not.toContain(id)
    }
    for (const id of [
      'cp-board',
      'cp-digitalio',
      'cp-analogio',
      'cp-pwmio',
      'cp-busio',
      'cp-timing',
      'cp-code-py',
      'cp-readonly',
      'cp-libraries',
      'cp-firmware'
    ]) {
      expect(cp, `${id} missing`).toContain(id)
    }
    // …and the reverse: MicroPython never sees the CircuitPython pages.
    const mp = articleIds(mpTree)
    expect(mp).toContain('ref-pins')
    expect(mp).not.toContain('cp-digitalio')
  })

  it('keeps the plain-Python pages on both, rather than duplicating them', () => {
    for (const id of ['ref-flow', 'ref-types', 'ref-classes', 'ref-imports', 'ref-print']) {
      expect(articleIds(cpTree), id).toContain(id)
      expect(articleIds(mpTree), id).toContain(id)
    }
  })

  it('never shows a CircuitPython reader MicroPython code in Reference or Getting Started', () => {
    // THE acceptance criterion. Prose that names `machine` to contrast the two
    // runtimes is fine and useful; a copyable snippet that won't run is not.
    for (const section of ['getting-started', 'reference']) {
      const node = find(cpTree, section)!
      for (const id of articleIds([node])) {
        expect(microPythonCode(id), `${id} teaches MicroPython to a CircuitPython reader`).toEqual([])
      }
    }
  })

  it('flags any other CircuitPython-visible page whose examples are MicroPython', () => {
    // The instrument pages are MicroPython-only until the on-device library is
    // ported (#760). They stay visible — they document the panels — but must
    // carry the note. This keeps the exception list honest: a new page with
    // MicroPython code either gets scoped out or gets a note.
    for (const id of articleIds(cpTree)) {
      if (microPythonCode(id).length === 0) continue
      expect(dialectNote(id, 'circuitpython'), `${id} has MicroPython code and no note`).toBeTruthy()
    }
  })

  it('adds no note on MicroPython, or to a page written for CircuitPython', () => {
    for (const id of articleIds(mpTree)) expect(dialectNote(id, 'micropython'), id).toBeNull()
    expect(dialectNote('cp-digitalio', 'circuitpython')).toBeNull()
  })

  it('drops a section that has lost all its pages', () => {
    // "CircuitPython Hardware" must not appear as an empty book on MicroPython.
    expect(find(mpTree, 'ref-circuitpython')).toBeUndefined()
    expect(find(cpTree, 'ref-micropython')).toBeUndefined()
  })

  it('shows both runtimes when the dialect is not established', () => {
    const ids = articleIds(helpTreeFor('unknown'))
    expect(ids).toContain('ref-pins')
    expect(ids).toContain('cp-digitalio')
  })

  it('every article the API table points at exists in the right dialect’s tree', () => {
    // The equivalence table is what sends a misplaced `machine` somewhere useful;
    // a typo'd article id there would be a silent dead end.
    for (const row of API_EQUIVALENTS) {
      for (const d of ['micropython', 'circuitpython'] as Dialect[]) {
        const article = apiFor(row, d)!.article
        expect(articleIds(helpTreeFor(d)), `${row.id} → ${article} (${d})`).toContain(article)
      }
    }
  })

  it('the "Coming from MicroPython" page covers every row of the table', () => {
    // The page is hand-written prose; this stops it drifting from the data that
    // drives the completions and the context-help redirect.
    const body = HELP_ARTICLES['cp-from-micropython'] ?? ''
    for (const row of API_EQUIVALENTS) {
      expect(body, `${row.id}: “${row.title}” not covered`).toContain(row.title)
      for (const mod of row.circuitpython.modules) {
        expect(body, `${row.id}: ${mod} not mentioned`).toContain(mod)
      }
    }
  })

  it('every Getting Started article in the tree has authored content (#231)', () => {
    const gs = find(HELP_SECTIONS, 'getting-started')!
    // The feature articles added in #231 are registered…
    for (const id of [
      'gs-files',
      'gs-firmware',
      'gs-packages',
      'gs-validation',
      'gs-git',
      'gs-chat',
      'gs-updater'
    ]) {
      expect(gs.children!.some((n) => n.id === id), `${id} in tree`).toBe(true)
    }
    // …and every tree entry has a real body (no "not written yet" stubs).
    for (const n of gs.children!) {
      expect((HELP_ARTICLES[n.id] ?? '').length, `content for ${n.id}`).toBeGreaterThan(200)
    }
  })
})

const libs = (parts: object[]): PartLibraryWithParts[] =>
  [{ id: 'l', name: 'L', parts } as unknown as PartLibraryWithParts]

describe('detectProjectParts (In This Project)', () => {
  const sg90 = { id: 'sg90', name: 'SG90 Servo', library: { module: 'servo' }, helpText: '# SG90', headers: [] }
  const vl = { id: 'vl53l0x', name: 'VL53L0X', helpText: '# ToF', headers: [] }

  it('surfaces a part when the file imports its module', () => {
    const out = detectProjectParts('from servo import Servo\ns = Servo(16)', libs([sg90, vl]))
    expect(out.map((p) => p.part.id)).toEqual(['sg90'])
    expect(out[0].live).toBe(true)
    expect(out[0].articleId).toBe('part-sg90')
    expect(out[0].atCursor).toBe(false)
  })

  it('matches by part id too (import vl53l0x)', () => {
    const out = detectProjectParts('import vl53l0x', libs([sg90, vl]))
    expect(out.map((p) => p.part.id)).toEqual(['vl53l0x'])
  })

  it('tags the part whose declaration line the caret is on', () => {
    const out = detectProjectParts('from servo import Servo', libs([sg90]), 'from servo import Servo')
    expect(out[0].atCursor).toBe(true)
  })

  it('returns nothing when no known part is imported', () => {
    expect(detectProjectParts('print("hi")', libs([sg90, vl]))).toEqual([])
    expect(detectProjectParts('', libs([sg90]))).toEqual([])
  })
})
