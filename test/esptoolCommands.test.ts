import { describe, it, expect } from 'vitest'
import {
  esptoolCommandStyle,
  eraseFlashCommand,
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
