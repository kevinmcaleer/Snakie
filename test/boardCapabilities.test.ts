/**
 * The board capability probe and the on-device benchmark (epic #634 §2.5/§3.7,
 * issue #806).
 *
 * Both are built as a pure snippet builder plus a pure parser — the same shape
 * as `boardPackagesProbe` — precisely so the interesting behaviour can be tested
 * against canned REPL output with no hardware in CI.
 *
 * The gating rules these enforce are the epic's, and they matter: a wrong
 * optimisation hint costs more trust than a missing one.
 */
import { describe, expect, it } from 'vitest'
import {
  buildCapabilityProbe,
  parseCapabilityProbe,
  stateMachineCount,
  staticCapabilitiesFor
} from '../src/renderer/src/lib/board-capabilities'
import {
  benchmarkVerdict,
  buildBenchmarkProbe,
  compareBenchmarks,
  formatDuration,
  parseBenchmarkResult,
  zeroArgFunctionNames
} from '../src/renderer/src/lib/refactor-benchmark'

describe('board capability probe (#634 §2.5)', () => {
  it('tests each emitter by COMPILING it, since a missing emitter fails at compile time', () => {
    const probe = buildCapabilityProbe()
    expect(probe).toContain('micropython.native')
    expect(probe).toContain('micropython.viper')
    expect(probe).toContain('asm_thumb')
    expect(probe).toContain('asm_xtensa')
    expect(probe).toContain('asm_rv32')
    expect(probe).toContain('rp2.asm_pio')
    // Compiling is the whole test — nothing probed is ever called.
    expect(probe).toContain('exec(s)')
  })

  it('parses a Pico probe into full RP2 capabilities', () => {
    const caps = parseCapabilityProbe(
      '{"native": true, "viper": true, "thumb": true, "xtensa": false, "rv32": false, ' +
        '"pio": true, "machine": "Raspberry Pi Pico with RP2040", "version": "1.24.0", "mem": 187000}'
    )
    expect(caps).toMatchObject({
      native: true,
      viper: true,
      asm: 'thumb',
      pio: true,
      memFree: 187000,
      stateMachines: 8
    })
  })

  it('parses an ESP32 probe: no PIO, xtensa assembler', () => {
    const caps = parseCapabilityProbe(
      '{"native": true, "viper": true, "thumb": false, "xtensa": true, "rv32": false, ' +
        '"pio": false, "machine": "ESP32 module with ESP32", "version": "1.22.2", "mem": 90000}'
    )
    expect(caps?.pio).toBe(false)
    expect(caps?.asm).toBe('xtensa')
    expect(caps?.stateMachines).toBeUndefined()
  })

  it('reads the assembler from the probe, never from the MCU name (RP2350 boots Arm OR RISC-V)', () => {
    const riscv = parseCapabilityProbe(
      '{"native": true, "viper": true, "thumb": false, "xtensa": false, "rv32": true, ' +
        '"pio": true, "machine": "Raspberry Pi Pico 2 with RP2350", "version": "1.24.0", "mem": 400000}'
    )
    expect(riscv?.asm).toBe('rv32')
    expect(riscv?.stateMachines).toBe(12)

    const arm = parseCapabilityProbe(
      '{"native": true, "viper": true, "thumb": true, "xtensa": false, "rv32": false, ' +
        '"pio": true, "machine": "Raspberry Pi Pico 2 with RP2350", "version": "1.24.0", "mem": 400000}'
    )
    expect(arm?.asm).toBe('thumb')
    // Same MCU string, different assembler — which is exactly the point.
    expect(arm?.machine).toBe(riscv?.machine)
  })

  it('reports no assembler when no emitter compiled', () => {
    const caps = parseCapabilityProbe(
      '{"native": false, "viper": false, "thumb": false, "xtensa": false, "rv32": false, ' +
        '"pio": false, "machine": "trimmed board", "version": "1.20.0", "mem": 20000}'
    )
    expect(caps?.asm).toBeNull()
    expect(caps?.native).toBe(false)
  })

  it('tolerates REPL noise around the JSON, and gives up cleanly on junk', () => {
    expect(
      parseCapabilityProbe('>>> \r\n{"native": true, "machine": "x", "version": "1", "mem": 1}\r\n>>> ')
    ).toMatchObject({ native: true })
    expect(parseCapabilityProbe('Traceback (most recent call last):')).toBeNull()
    expect(parseCapabilityProbe('{not json}')).toBeNull()
  })

  it('counts state machines per chip', () => {
    expect(stateMachineCount('Raspberry Pi Pico with RP2040')).toBe(8)
    expect(stateMachineCount('Raspberry Pi Pico 2 with RP2350')).toBe(12)
  })

  describe('static fallback, for firmware without exec', () => {
    it('marks its answers as inferred so the copy hedges', () => {
      expect(staticCapabilitiesFor('RP2040').inferred).toBe(true)
      expect(staticCapabilitiesFor('ESP32').inferred).toBe(true)
    })

    it('never guesses the assembler', () => {
      expect(staticCapabilitiesFor('RP2040').asm).toBeNull()
      expect(staticCapabilitiesFor('RP2350').asm).toBeNull()
      expect(staticCapabilitiesFor('ESP32').asm).toBeNull()
    })

    it('only claims PIO for the RP2 family', () => {
      expect(staticCapabilitiesFor('RP2040').pio).toBe(true)
      expect(staticCapabilitiesFor('RP2350').pio).toBe(true)
      expect(staticCapabilitiesFor('ESP32').pio).toBe(false)
      expect(staticCapabilitiesFor('SAMD21').pio).toBe(false)
    })

    it('claims nothing at all for an unknown MCU', () => {
      const caps = staticCapabilitiesFor('SOMETHING-NEW')
      expect(caps.native).toBe(false)
      expect(caps.viper).toBe(false)
      expect(caps.pio).toBe(false)
      expect(caps.asm).toBeNull()
    })
  })
})

describe('on-device benchmark (#634 §3.7 "measure it, don\'t guess it")', () => {
  it('only offers functions it can call without inventing arguments', () => {
    const src = [
      'def hot():',
      '    return 1',
      'def needs_args(a, b):',
      '    return a + b',
      'def also_fine():',
      '    pass',
      '    def nested():',
      '        pass'
    ].join('\n')
    expect(zeroArgFunctionNames(src)).toEqual(['hot', 'also_fine'])
  })

  it('times with ticks_diff, not a raw subtraction that could wrap', () => {
    const probe = buildBenchmarkProbe('def hot():\n    pass\n', 'hot', 100)
    expect(probe).toContain('ticks_diff')
    expect(probe).not.toMatch(/_t1\s*-\s*_t0/)
    // A warm-up call and a collect keep compilation and GC out of the measurement.
    expect(probe).toContain('gc.collect()')
    expect(probe).toContain('for _ in range(100):')
  })

  it('embeds the source safely, however it is quoted', () => {
    const nasty = 'def hot():\n    s = "quote\\"inside"\n    return s\n'
    const probe = buildBenchmarkProbe(nasty, 'hot', 10)
    // The source is JSON-encoded, so no raw newline or quote leaks into the snippet.
    expect(probe.split('\n').filter((l) => l.startsWith('exec('))).toHaveLength(1)
  })

  it('bounds the iteration count so a benchmark cannot hang the board', () => {
    expect(buildBenchmarkProbe('def h():\n    pass\n', 'h', 10_000_000)).toContain('range(100000)')
    expect(buildBenchmarkProbe('def h():\n    pass\n', 'h', 0)).toContain('range(1)')
  })

  it('parses a timing and computes per-call microseconds', () => {
    expect(parseBenchmarkResult('{"us": 4200, "n": 200}')).toEqual({
      totalUs: 4200,
      iterations: 200,
      perCallUs: 21
    })
  })

  it('rejects a negative total, which means the tick counter wrapped', () => {
    expect(parseBenchmarkResult('{"us": -5, "n": 10}')).toBeNull()
    expect(parseBenchmarkResult('{"us": 10, "n": 0}')).toBeNull()
    expect(parseBenchmarkResult('MemoryError')).toBeNull()
  })

  it('is blunt about small wins, which is the point of measuring', () => {
    const at = (speedup: number): string => {
      const before = { totalUs: 1000 * speedup, iterations: 1, perCallUs: 1000 * speedup }
      const after = { totalUs: 1000, iterations: 1, perCallUs: 1000 }
      return benchmarkVerdict(compareBenchmarks(before, after).speedup)
    }
    expect(at(2.2)).toBe('2.2× faster')
    expect(at(1.04)).toContain('probably not worth it')
    expect(at(1.0)).toBe('no measurable difference')
    expect(at(0.5)).toContain('SLOWER')
  })

  it('formats durations at a readable scale', () => {
    expect(formatDuration(21)).toBe('21 µs')
    expect(formatDuration(4.25)).toBe('4.25 µs')
    expect(formatDuration(4200)).toBe('4.20 ms')
    expect(formatDuration(42000)).toBe('42.0 ms')
  })
})
