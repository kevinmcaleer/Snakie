import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The flasher should say, in words, what it is about to do.
 *
 * Three separate bugs in this area (#826, #834, #836) all produced the same
 * symptom — a flash that reports success and leaves a board that will not boot
 * — and all three came down to one of three facts differing from what the
 * dialog implied: WHICH FILE, WHAT ADDRESS, and WHETHER IT ERASED FIRST.
 *
 * Every one of those was already knowable from the esptool argv in the log, and
 * every one went unnoticed for days because reading an argv by eye is not
 * something a user should have to do to answer "did it erase?".
 */
const SRC = readFileSync(join(__dirname, '..', 'src/main/firmware/flasher.ts'), 'utf-8')

describe('the flash summary line', () => {
  const line = /message:\s*\n?\s*`Flashing \$\{[\s\S]*?\.`\s*\n\s*\}\)/.exec(SRC)?.[0] ?? ''

  it('exists, before the esptool command is run', () => {
    expect(line, 'no plain-language summary is emitted').toBeTruthy()
    expect(SRC.indexOf('Flashing ${basename')).toBeLessThan(SRC.indexOf('const { code, spawnError }'))
  })

  it('names the FILE — which build is being written', () => {
    // "Download & Flash" of the wrong build looks identical to the right one.
    expect(line).toContain('basename(opts.firmwarePath)')
  })

  it('names the ADDRESS — a wrong offset writes cleanly and bricks the board', () => {
    expect(line).toContain('${offset}')
  })

  it('says whether it ERASED — the fact that hid #834 for days', () => {
    expect(line).toContain('opts.eraseFirst')
    // Both branches spelled out: "not erasing" has to be as visible as erasing,
    // because its absence is what nobody noticed.
    expect(line).toMatch(/ERASING/)
    expect(line).toMatch(/WITHOUT erasing/)
  })
})
