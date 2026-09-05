import { describe, it, expect } from 'vitest'
import {
  clampSimHeapBytes,
  formatSimHeap,
  simHeapNeedsRestart,
  simHeapPresetFor,
  SIM_HEAP_DEFAULT_BYTES,
  SIM_HEAP_MAX_BYTES,
  SIM_HEAP_MIN_BYTES,
  SIM_HEAP_PRESETS
} from '../src/shared/sim-memory'

/**
 * The simulated board's heap decisions (#901) — pure, so they're tested without
 * Electron, a DOM or a WebAssembly load.
 */

describe('clampSimHeapBytes', () => {
  it('keeps a sensible size untouched', () => {
    expect(clampSimHeapBytes(192 * 1024)).toBe(192 * 1024)
  })

  it('clamps to the offered range at both ends', () => {
    expect(clampSimHeapBytes(1)).toBe(SIM_HEAP_MIN_BYTES)
    expect(clampSimHeapBytes(SIM_HEAP_MAX_BYTES * 4)).toBe(SIM_HEAP_MAX_BYTES)
  })

  it('rounds to whole KB, so the UI never shows false precision', () => {
    expect(clampSimHeapBytes(100_500)).toBe(98 * 1024)
  })

  it('falls back to the default for anything unusable — a corrupt stored value must never stop the sim booting', () => {
    for (const bad of [NaN, Infinity, -1, 0, null, undefined, 'nonsense', {}, []]) {
      expect(clampSimHeapBytes(bad)).toBe(SIM_HEAP_DEFAULT_BYTES)
    }
  })

  it('accepts a numeric string (what a number input hands back)', () => {
    expect(clampSimHeapBytes('196608')).toBe(192 * 1024)
  })
})

describe('formatSimHeap', () => {
  it('reads in KB below a megabyte and MB above', () => {
    expect(formatSimHeap(32 * 1024)).toBe('32 KB')
    expect(formatSimHeap(192 * 1024)).toBe('192 KB')
    expect(formatSimHeap(1024 * 1024)).toBe('1 MB')
    expect(formatSimHeap(8 * 1024 * 1024)).toBe('8 MB')
  })

  it('keeps one decimal for a size between the two', () => {
    expect(formatSimHeap(1536 * 1024)).toBe('1.5 MB')
  })
})

describe('SIM_HEAP_PRESETS', () => {
  it('every preset is inside the offered range and survives clamping', () => {
    for (const preset of SIM_HEAP_PRESETS) {
      expect(preset.bytes).toBeGreaterThanOrEqual(SIM_HEAP_MIN_BYTES)
      expect(preset.bytes).toBeLessThanOrEqual(SIM_HEAP_MAX_BYTES)
      expect(clampSimHeapBytes(preset.bytes)).toBe(preset.bytes)
    }
  })

  it('offers the WASM port’s own default, so "put it back" is one click', () => {
    expect(SIM_HEAP_PRESETS.some((p) => p.bytes === SIM_HEAP_DEFAULT_BYTES)).toBe(true)
  })

  it('hedges every hardware comparison — none of these emulates the named board', () => {
    for (const preset of SIM_HEAP_PRESETS) {
      if (/ESP|Pico|RP2040/i.test(preset.hint)) expect(preset.hint).toMatch(/Roughly/)
    }
  })
})

describe('simHeapPresetFor', () => {
  it('finds the preset for an exact size', () => {
    expect(simHeapPresetFor(SIM_HEAP_DEFAULT_BYTES)?.id).toBe('default')
  })

  it('returns null for a custom size', () => {
    expect(simHeapPresetFor(123 * 1024)).toBeNull()
  })
})

describe('simHeapNeedsRestart', () => {
  it('is false when nothing is running — there is nothing to restart', () => {
    expect(simHeapNeedsRestart(null, 32 * 1024)).toBe(false)
  })

  it('is false when the live interpreter already has the wanted heap', () => {
    expect(simHeapNeedsRestart(192 * 1024, 192 * 1024)).toBe(false)
  })

  it('is true when the live interpreter booted with a different heap', () => {
    // The heap is fixed at mp_js_init, so this can only be resolved by a restart.
    expect(simHeapNeedsRestart(1024 * 1024, 32 * 1024)).toBe(true)
  })
})
