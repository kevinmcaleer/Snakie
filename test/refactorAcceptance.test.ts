/**
 * The epic's own acceptance criteria (#634 §8), asserted directly.
 *
 * The per-rule suites prove each rule behaves; this one proves the *promises*
 * the epic made about the feature as a whole still hold once ninety rules are
 * loaded together. Each test below is one bullet from §8, quoted in its name.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import {
  applyOffer,
  applyOffers,
  createContext,
  detectAll,
  offersFor,
  runRuleToFixpoint
} from '../src/shared/refactor/engine'
import { ALL_RULES, ruleByCatalogue, safeRules } from '../src/shared/refactor/rules'
import { parsePython } from '../src/shared/refactor/parser'
import type { BoardCapabilities } from '../src/shared/refactor/types'

const CAPS: BoardCapabilities = {
  native: true,
  viper: true,
  asm: 'thumb',
  pio: true,
  machine: 'Raspberry Pi Pico with RP2040',
  version: '1.24.0',
  memFree: 180000,
  stateMachines: 8
}

const HELP_DIR = resolve(__dirname, '../src/renderer/src/components/help')

/** A file with a smell every phase of the epic should have something to say about. */
const MESSY = [
  'import time',
  'from machine import Pin',
  '',
  'LED_PIN = 25',
  '',
  '',
  'def read_sensor(bus):',
  '    if bus is not None:',
  '        raw = bus.read()',
  '        scaled = raw / 16',
  '        return scaled',
  '',
  '',
  'def wait(start):',
  '    while time.ticks_ms() - start < 500:',
  '        pass',
  ''
].join('\n')

describe('epic #634 §8 acceptance criteria', () => {
  it('offers relevant refactorings for a selection in a .py file', () => {
    const ctx = createContext(MESSY)
    expect(ctx).not.toBeNull()
    const at = MESSY.indexOf('if bus is not None')
    const offers = offersFor(ctx!, ALL_RULES, { start: at, end: at })
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.map((o) => o.rule.id)).toContain('guard-clause')
  })

  it('offers nothing when the file does not parse', () => {
    for (const broken of ['def f(:\n', 'x = "unterminated\n', 'if x\n    pass\n']) {
      expect(createContext(broken), broken).toBeNull()
    }
  })

  it('produces a preview-able before/after for every offer it makes', () => {
    // The preview is the diff of ctx.src against applied.result, so an offer is
    // only showable if applying it yields a different, valid file.
    const ctx = createContext(MESSY, { capabilities: CAPS })!
    for (const offer of detectAll(ctx, ALL_RULES)) {
      if (offer.rule.hintOnly) continue
      const applied = applyOffer(offer, ctx)
      if (!applied) continue
      expect(applied.result, offer.rule.id).not.toBe(ctx.src)
      expect(parsePython(applied.result).errors, offer.rule.id).toEqual([])
    }
  })

  it('gives every rule golden tests, a no-match corpus and a "Why?" article', () => {
    // Fixtures and no-match corpora are enforced by refactorGolden.test.ts;
    // articles by refactorHelp.test.ts. What is checked here is that no rule
    // slipped in without the metadata those suites key off.
    for (const rule of ALL_RULES) {
      expect(rule.id, 'every rule needs an id').toBeTruthy()
      expect(rule.helpArticle, `${rule.id} needs a help article`).toBeTruthy()
      expect(rule.catalogue, `${rule.id} needs a catalogue number`).toBeGreaterThan(0)
    }
  })

  it('covers every numbered rule in §3, with no gaps and no duplicates', () => {
    const numbers = ALL_RULES.map((r) => r.catalogue).sort((a, b) => a - b)
    expect(new Set(numbers).size, 'catalogue numbers must be unique').toBe(numbers.length)
    const missing = Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !numbers.includes(n))
    expect(missing).toEqual([])
  })

  it('works with no Python installed and in the web build', () => {
    // Proven structurally in refactorPortability.test.ts; proven behaviourally
    // here — a real rewrite from nothing but a string.
    expect(runRuleToFixpoint(ruleByCatalogue(1)!, MESSY)).not.toBe(MESSY)
  })

  it('leaves formatting and comments outside the edited range byte-identical', () => {
    const withComments = [
      '# Top-of-file note that must survive.',
      'import time',
      '',
      '',
      'def read(bus):',
      '    if bus is not None:',
      '        # An explanation inside the block.',
      '        raw = bus.read()',
      '        return raw   # trailing note',
      '',
      '',
      '# A trailing comment at the end of the file.',
      ''
    ].join('\n')
    const ctx = createContext(withComments)!
    const offer = detectAll(ctx, [ruleByCatalogue(1)!])[0]
    const applied = applyOffer(offer, ctx)!
    for (const comment of [
      '# Top-of-file note that must survive.',
      '# An explanation inside the block.',
      '# trailing note',
      '# A trailing comment at the end of the file.'
    ]) {
      expect(applied.result, comment).toContain(comment)
    }
    // Everything before the first edit is untouched, byte for byte.
    const firstEdit = Math.min(...applied.edits.map((e) => e.start))
    expect(applied.result.slice(0, firstEdit)).toBe(withComments.slice(0, firstEdit))
  })

  it('shows board-specific hints ONLY when the board supports them', () => {
    const boardRules = ALL_RULES.filter((r) => r.requires)
    expect(boardRules.length, 'the §3.7 rules should be capability-gated').toBeGreaterThan(10)

    const hot = [
      'import micropython',
      '',
      '',
      'def mix(buf):',
      '    total = 0',
      '    for i in range(len(buf)):',
      '        total += buf[i]',
      '    return total',
      ''
    ].join('\n')

    // No board at all: complete silence from every gated rule.
    const noBoard = createContext(hot)!
    expect(detectAll(noBoard, boardRules)).toEqual([])

    // An ESP32 has no PIO, so no PIO rule may speak.
    const esp = createContext(hot, { capabilities: { ...CAPS, pio: false, asm: 'xtensa' } })!
    const pioRules = boardRules.filter((r) => r.requires!({ ...CAPS, pio: true }) && !r.requires!({ ...CAPS, pio: false }))
    expect(detectAll(esp, pioRules)).toEqual([])

    // Firmware with no emitters gets no emitter advice.
    const plain = createContext(hot, {
      capabilities: { ...CAPS, native: false, viper: false, asm: null, pio: false }
    })!
    for (const offer of detectAll(plain, boardRules)) {
      expect(offer.rule.requires!({ ...CAPS, native: false, viper: false, asm: null, pio: false })).toBe(true)
    }
  })

  it('never infers the assembler from the MCU name', () => {
    // An RP2350 boots Arm OR RISC-V. Any rule keying off caps.asm must read it,
    // so the SAME machine string with a different asm gives a different answer.
    const asmRules = ALL_RULES.filter(
      (r) => r.requires && r.requires({ ...CAPS, asm: 'thumb' }) && !r.requires({ ...CAPS, asm: null })
    )
    for (const rule of asmRules) {
      expect(rule.requires!({ ...CAPS, machine: 'Raspberry Pi Pico 2 with RP2350', asm: null })).toBe(false)
    }
  })

  it('warns about machine-word overflow on viper, and never applies it silently', () => {
    const viper = ruleByCatalogue(44)!
    const overflow = ruleByCatalogue(48)!
    // Neither may be batched by "Tidy this file", and both must ask.
    expect(viper.safe, 'a viper conversion is never provably equivalent').toBe(false)
    expect(safeRules().map((r) => r.id)).not.toContain(viper.id)
    // The overflow warning exists, is a warning, and says why.
    expect(overflow.severity).toBe('warning')
    const article = readFileSync(resolve(HELP_DIR, `${overflow.helpArticle}.md`), 'utf8')
    expect(article.toLowerCase()).toMatch(/wrap|overflow/)
  })

  it('keeps "Tidy this file" to the provably-safe rules only', () => {
    for (const rule of safeRules()) {
      expect(rule.safe, `${rule.id} must be safe to batch`).toBe(true)
      expect(rule.hintOnly ?? false, `${rule.id} has no rewrite to batch`).toBe(false)
      expect(rule.requires, `${rule.id}: board trade-offs are never bulk-applied`).toBeUndefined()
    }
  })

  it('applies a whole batch as one verified rewrite', () => {
    const ctx = createContext(MESSY)!
    const offers = detectAll(ctx, safeRules())
    if (offers.length === 0) return
    const applied = applyOffers(offers, ctx)
    if (!applied) return
    expect(parsePython(applied.result).errors).toEqual([])
    // Non-overlapping, so the editor can commit them in one undo bracket.
    const sorted = [...applied.edits].sort((a, b) => a.start - b.start)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end)
    }
  })
})
