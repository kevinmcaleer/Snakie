import { describe, it, expect } from 'vitest'
import { shouldDeleteSelectedPart } from '../src/renderer/src/components/WiringCanvas'

/** The Delete/Backspace guard for removing the selected breadboard part. */
describe('shouldDeleteSelectedPart', () => {
  it('deletes on Delete or Backspace over the canvas', () => {
    expect(shouldDeleteSelectedPart('Delete', { tagName: 'DIV' })).toBe(true)
    expect(shouldDeleteSelectedPart('Backspace', { tagName: 'svg' })).toBe(true)
    expect(shouldDeleteSelectedPart('Delete', null)).toBe(true)
  })

  it('ignores other keys', () => {
    for (const k of ['a', 'Enter', 'Escape', 'ArrowLeft', 'd']) {
      expect(shouldDeleteSelectedPart(k, { tagName: 'DIV' })).toBe(false)
    }
  })

  it('does NOT delete while typing in an editable field', () => {
    expect(shouldDeleteSelectedPart('Backspace', { tagName: 'INPUT' })).toBe(false)
    expect(shouldDeleteSelectedPart('Delete', { tagName: 'TEXTAREA' })).toBe(false)
    expect(shouldDeleteSelectedPart('Backspace', { tagName: 'SELECT' })).toBe(false)
    expect(shouldDeleteSelectedPart('Delete', { tagName: 'DIV', isContentEditable: true })).toBe(false)
  })
})
