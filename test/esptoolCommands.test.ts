import { describe, it, expect } from 'vitest'
import {
  esptoolCommandStyle,
  eraseFlashCommand,
  flashOptionFlag,
  writeFlashCommand
} from '../src/main/firmware/flasher'

/**
 * esptool renamed its subcommands to hyphens in v5 (#680).
 *
 * v5 still accepts the underscore forms but warns on every run; a deprecation is
 * a removal notice, so v6 dropping them would break every ESP flash at once.
 */
describe('esptoolCommandStyle (#680)', () => {
  it('uses hyphens from v5 onward', () => {
    // The exact banner esptool prints, as seen in a real flash log.
    expect(esptoolCommandStyle('esptool v5.3.0')).toBe('hyphen')
    expect(esptoolCommandStyle('esptool.py v5.0')).toBe('hyphen')
    expect(esptoolCommandStyle('v6.1.2')).toBe('hyphen')
    expect(esptoolCommandStyle('10.0.0')).toBe('hyphen')
  })

  it('keeps underscores below v5, where hyphens do not exist', () => {
    expect(esptoolCommandStyle('esptool.py v4.7.0')).toBe('underscore')
    expect(esptoolCommandStyle('v3.3.1')).toBe('underscore')
  })

  it('falls back to UNDERSCORES when the version is unreadable', () => {
    // They work on every released version to date, so they are the safe guess.
    expect(esptoolCommandStyle(undefined)).toBe('underscore')
    expect(esptoolCommandStyle('')).toBe('underscore')
    expect(esptoolCommandStyle('some unexpected banner')).toBe('underscore')
    expect(esptoolCommandStyle('esptool vX.Y')).toBe('underscore')
  })

  it('spells both commands consistently', () => {
    expect(eraseFlashCommand('esptool v5.3.0')).toBe('erase-flash')
    expect(writeFlashCommand('esptool v5.3.0')).toBe('write-flash')
    expect(eraseFlashCommand('esptool.py v4.7.0')).toBe('erase_flash')
    expect(writeFlashCommand('esptool.py v4.7.0')).toBe('write_flash')
  })
})

describe('the --flash-mode / --flash-size flags (#829 parity)', () => {
  it('uses hyphens on v5, matching the subcommand spelling', () => {
    expect(flashOptionFlag('flash-mode', 'esptool v5.3.0')).toBe('--flash-mode')
    expect(flashOptionFlag('flash-size', 'esptool v5.3.0')).toBe('--flash-size')
  })

  it('uses underscores on v4 — there the hyphen form is not a warning but a failure', () => {
    // An unrecognised argument aborts the flash, unlike the deprecated
    // subcommand spelling which merely warns.
    expect(flashOptionFlag('flash-mode', 'esptool.py v4.7.0')).toBe('--flash_mode')
    expect(flashOptionFlag('flash-size', 'esptool.py v4.7.0')).toBe('--flash_size')
  })

  it('falls back to underscores when the version cannot be read', () => {
    // Same rule as the subcommands: the old spelling works everywhere to date.
    expect(flashOptionFlag('flash-mode', undefined)).toBe('--flash_mode')
    expect(flashOptionFlag('flash-size', 'unparseable')).toBe('--flash_size')
  })
})
