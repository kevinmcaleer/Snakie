import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MpyReadError,
  formatSignature,
  isMpyFile,
  parseMpy,
  type MpyScope
} from '../src/shared/mpy-info'

/**
 * READING A `.mpy` (#875).
 * =============================================================================
 *
 * Every fixture here is a REAL `.mpy`, produced by `mpy-cross` 1.29.0 from the
 * `.py` committed beside it in `test/fixtures/mpy/`, and every expectation was
 * cross-checked against MicroPython's own reference reader
 * (`tools/mpy-tool.py -d`) rather than against this parser's output. So these
 * assert the FORMAT, not our reading of it.
 *
 * Two halves, and the second matters as much as the first:
 *
 *   - What a `.mpy` KEEPS — the header, the source file name, the qstr table
 *     (including the static qstrs, whose text is not in the file at all), the
 *     constant table, and the scope tree with real argument names.
 *
 *   - What a `.mpy` DROPS — docstrings, local variable names, `*args`/`**kwargs`
 *     names. These are the claims the issue actually asked about, and they only
 *     stay true if something checks that the strings are genuinely absent from
 *     the compiled bytes. `shapes.py` carries deliberately distinctive
 *     identifiers so that check cannot pass by accident.
 *
 * Plus the failure half: a truncated or corrupt file must produce a sentence,
 * never a crash and never a hang.
 *
 * `adafruit_hcsr04.mpy` is the exception to "built here": it is the real,
 * unmodified library out of `adafruit-circuitpython-hcsr04-9.x-mpy-0.4.25.zip`
 * (Adafruit, MIT). Third-party output from a DIFFERENT compiler is the only
 * thing that proves the reader is reading the format rather than mpy-cross's
 * habits — and it is a file Snakie itself installs, via the bundle route in
 * `circuitpy-bundle.ts`.
 */

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/mpy', name)))

/** Depth-first list of every scope, so a tree can be asserted in one go. */
function flatten(scope: MpyScope): MpyScope[] {
  return [scope, ...scope.children.flatMap(flatten)]
}

describe('parseMpy — the header', () => {
  it('reads a bytecode-only file as portable, with no ABI sub-version', () => {
    const info = parseMpy(fixture('blinker.mpy'))
    expect(info.flavour).toBe('micropython')
    expect(info.version).toBe(6)
    expect(info.arch).toBe('none')
    expect(info.hasNativeCode).toBe(false)
    expect(info.smallIntBits).toBe(31)
    expect(info.archFlags).toBeNull()
    // mpy-cross only writes the sub-version when the file holds native code, and
    // the loader only checks it then — reporting "6.0" here would be inventing a
    // fact the file does not state.
    expect(info.subVersion).toBeNull()
  })

  it('reads the native architecture and sub-version out of a native file', () => {
    const info = parseMpy(fixture('native.mpy'))
    expect(info.arch).toBe('armv7m')
    expect(info.hasNativeCode).toBe(true)
    expect(info.subVersion).toBe(3)
  })

  it('recovers the name of the .py it was compiled from', () => {
    expect(parseMpy(fixture('blinker.mpy')).sourceName).toBe('blinker.py')
    expect(parseMpy(fixture('shapes.mpy')).sourceName).toBe('shapes.py')
  })
})

describe('parseMpy — the qstr table', () => {
  it('reads every interned name, in file order', () => {
    // Byte-for-byte the table `mpy-tool.py -d blinker.mpy` prints.
    expect(parseMpy(fixture('blinker.mpy')).qstrs).toEqual([
      'blinker.py',
      '<module>',
      '1.2.3',
      'Blinker',
      'make_blinker',
      'interval',
      '__init__',
      'pin',
      'blink',
      'toggle',
      'VERSION',
      '_GREETING',
      '__name__',
      '__module__',
      '__qualname__',
      'self',
      'times'
    ])
  })

  it('resolves static qstrs, whose text is never in the file', () => {
    // `__init__`, `self`, `__qualname__` and friends are stored as bare INDICES
    // into the firmware's built-in table. Without MPY_STATIC_QSTRS they would
    // come back as numbers, so `Blinker.__init__` would have no name at all.
    const raw = fixture('blinker.mpy')
    const asText = Buffer.from(raw).toString('latin1')
    for (const name of ['__init__', 'self', '__qualname__', '__name__']) {
      expect(asText).not.toContain(name)
      expect(parseMpy(raw).qstrs).toContain(name)
    }
  })

  it('splits the table into names it defines and names it merely references', () => {
    const info = parseMpy(fixture('blinker.mpy'))
    // Scope names + argument names — provably identifiers.
    expect(info.definedNames).toEqual([
      'Blinker',
      'make_blinker',
      'interval',
      '__init__',
      'pin',
      'blink',
      'self',
      'times'
    ])
    // Everything else: attributes, globals, and short string literals that
    // mpy-cross interned. The container cannot tell those apart, so nor do we —
    // `1.2.3` is a string constant sitting in the same table as `toggle`.
    expect(info.referencedNames).toEqual([
      '1.2.3',
      'toggle',
      'VERSION',
      '_GREETING',
      '__name__',
      '__module__',
      '__qualname__'
    ])
  })
})

describe('parseMpy — the constant table', () => {
  it('reads strings and floats, with their types', () => {
    expect(parseMpy(fixture('blinker.mpy')).constants).toEqual([
      { kind: 'str', value: 'hello from the blinker' },
      { kind: 'float', value: '0.5' },
      { kind: 'float', value: '0.25' }
    ])
  })

  it('reads a native file’s function table entry', () => {
    expect(parseMpy(fixture('native.mpy')).constants).toEqual([
      { kind: 'fun-table', value: 'mp_fun_table' }
    ])
  })

  it('is empty when nothing needed one', () => {
    // Every literal in shapes.py is a small int or a short interned string, so
    // the object table is genuinely empty — not merely unread.
    expect(parseMpy(fixture('shapes.mpy')).constants).toEqual([])
  })
})

describe('parseMpy — the scope tree', () => {
  it('walks the module, its class and the class’s methods', () => {
    const info = parseMpy(fixture('blinker.mpy'))
    expect(info.module.name).toBe('<module>')
    expect(flatten(info.module).map((s) => s.qualifiedName)).toEqual([
      '<module>',
      'Blinker',
      'Blinker.__init__',
      'Blinker.blink',
      'make_blinker'
    ])
  })

  it('recovers argument names and which of them have defaults', () => {
    const byName = new Map(flatten(parseMpy(fixture('blinker.mpy')).module).map((s) => [s.name, s]))

    const init = byName.get('__init__')!
    expect(init.args).toEqual(['self', 'pin', 'interval'])
    expect(init.nPosArgs).toBe(3)
    expect(init.nDefaultArgs).toBe(1)
    expect(formatSignature(init)).toBe('__init__(self, pin, interval=…)')

    expect(formatSignature(byName.get('blink')!)).toBe('blink(self, times=…)')
    expect(formatSignature(byName.get('make_blinker')!)).toBe('make_blinker(pin)')

    // A class body is a scope with no arguments — the file gives no other way to
    // tell it apart from a function, which is why nothing here claims to.
    expect(byName.get('Blinker')!.args).toEqual([])
    expect(byName.get('Blinker')!.children.map((c) => c.name)).toEqual(['__init__', 'blink'])
  })

  it('reads the scope flags: generator, *args, **kwargs, keyword-only', () => {
    const byName = new Map(flatten(parseMpy(fixture('shapes.mpy')).module).map((s) => [s.name, s]))

    const counter = byName.get('counter')!
    expect(counter.isGenerator).toBe(true)
    expect(formatSignature(counter)).toBe('counter(limit)')

    const star = byName.get('star_taker')!
    expect(star.isGenerator).toBe(false)
    expect(star.takesVarArgs).toBe(true)
    expect(star.takesVarKeywords).toBe(true)
    // The FLAGS survive; the names `args_probe` / `kwargs_probe` do not.
    expect(star.args).toEqual([])
    expect(formatSignature(star)).toBe('star_taker(*…, **…)')

    const kwOnly = byName.get('kw_only')!
    expect(kwOnly.nPosArgs).toBe(1)
    expect(kwOnly.nKwOnlyArgs).toBe(1)
    expect(formatSignature(kwOnly)).toBe('kw_only(first_arg, *, zeta_kwonly)')
  })

  it('reads a native scope through its prelude offset', () => {
    const info = parseMpy(fixture('native.mpy'))
    const fn = info.module.children[0]
    expect(fn.kind).toBe('native')
    // The machine code is opaque, but the prelude beside it is not: the name and
    // the argument names come back exactly as for bytecode.
    expect(fn.name).toBe('fast_add')
    expect(fn.args).toEqual(['first', 'second'])
    expect(fn.codeSize).toBeGreaterThan(0)
  })
})

describe('what a .mpy does NOT keep', () => {
  const raw = fixture('shapes.mpy')
  const info = parseMpy(raw)
  const everything = [
    ...info.qstrs,
    ...info.constants.map((c) => c.value),
    ...flatten(info.module).flatMap((s) => [s.name, ...s.args])
  ].join(' ')
  const asText = Buffer.from(raw).toString('latin1')

  it('drops docstrings entirely', () => {
    // shapes.py has a module docstring and a function docstring, both tagged
    // ZZZ. MicroPython's compiler discards them — they are not in the constant
    // table, and not anywhere in the bytes either.
    expect(asText).not.toContain('ZZZ')
    expect(everything).not.toContain('ZZZ')
  })

  it('drops local variable names', () => {
    // Locals are addressed by slot number in the bytecode, so their names are
    // never written. Arguments are the exception, and they are kept.
    for (const local of ['gamma_local', 'delta_local', 'epsilon_local']) {
      expect(asText).not.toContain(local)
      expect(everything).not.toContain(local)
    }
    expect(everything).toContain('alpha_arg')
  })

  it('drops the names of *args and **kwargs', () => {
    for (const name of ['args_probe', 'kwargs_probe']) {
      expect(asText).not.toContain(name)
      expect(everything).not.toContain(name)
    }
    // …but a keyword-only argument is a real argument, so its name survives.
    expect(everything).toContain('zeta_kwonly')
  })
})

describe('a CircuitPython .mpy', () => {
  // CircuitPython's fork writes 'C' where MicroPython writes 'M' and changes
  // nothing else — including the static qstr table, which was compared entry for
  // entry against MicroPython's and is identical. Snakie installs these onto
  // CircuitPython boards, so refusing to read one would leave the commonest
  // real-world `.mpy` showing an error.
  it('is read, and reported as CircuitPython rather than assumed to be MicroPython', () => {
    const info = parseMpy(fixture('adafruit_hcsr04.mpy'))
    expect(info.flavour).toBe('circuitpython')
    expect(info.version).toBe(6)
    expect(info.sourceName).toBe('adafruit_hcsr04.py')
  })

  it('recovers a real third-party library’s public API', () => {
    const info = parseMpy(fixture('adafruit_hcsr04.mpy'))
    const cls = info.module.children[0]
    expect(cls.name).toBe('HCSR04')
    expect(cls.children.map(formatSignature)).toEqual([
      // Keyword-only `timeout` really does have a default (`timeout=0.1` in the
      // source), but the format records only that SOME keyword-only argument
      // does, never which — so it is shown bare rather than guessed at.
      '__init__(self, trigger_pin, echo_pin, *, timeout)',
      '__enter__(self)',
      '__exit__(self, exc_type, exc_val, exc_tb)',
      'deinit(self)',
      'distance(self)',
      '_dist_two_wire(self)'
    ])
    expect(cls.children[0].hasKeywordDefaults).toBe(true)
  })

  it('recovers the constants and the modules it imports', () => {
    const info = parseMpy(fixture('adafruit_hcsr04.mpy'))
    expect(info.constants.map((c) => c.value)).toContain(
      'https://github.com/adafruit/Adafruit_CircuitPython_HCSR04.git'
    )
    // The version string is short enough that mpy-cross interned it as a qstr
    // rather than a constant — the exact split the "other names" list warns about.
    expect(info.referencedNames).toContain('0.4.25')
    expect(info.referencedNames).toEqual(
      expect.arrayContaining(['digitalio', 'pulseio', 'microcontroller'])
    )
  })

  it('only the magic byte differs — the same bytes read the same either way', () => {
    // Strongest form of the claim: take a MicroPython file, change ONLY byte 0
    // to CircuitPython's 'C', and everything parsed out of it is unchanged.
    const asCircuitPython = Uint8Array.from(fixture('blinker.mpy'))
    asCircuitPython[0] = 0x43 // 'C'
    const { flavour, ...rest } = parseMpy(asCircuitPython)
    const { flavour: mpFlavour, ...mpRest } = parseMpy(fixture('blinker.mpy'))
    expect(flavour).toBe('circuitpython')
    expect(mpFlavour).toBe('micropython')
    expect(rest).toEqual(mpRest)
  })
})

describe('parseMpy — malformed input', () => {
  it('rejects an empty file', () => {
    expect(() => parseMpy(new Uint8Array())).toThrow(MpyReadError)
    expect(() => parseMpy(new Uint8Array())).toThrow(/too short/)
  })

  it('rejects a file that is not a .mpy', () => {
    const text = new TextEncoder().encode('print("hello")\n')
    expect(() => parseMpy(text)).toThrow(/does not start with the magic byte/)
    // 'P' from `print` is neither 'M' nor 'C', so this is a real rejection.
    expect(text[0]).toBe('p'.charCodeAt(0))
  })

  it('names the version when the format is one we do not read', () => {
    const old = Uint8Array.from(fixture('blinker.mpy'))
    old[1] = 5 // MicroPython v1.12–v1.18
    expect(() => parseMpy(old)).toThrow(/version 5/)
  })

  it('refuses a table count larger than the file', () => {
    // 17 qstrs becomes a 4-byte vuint claiming ~250 million, which must be
    // caught up front rather than looped over until the cursor runs off the end.
    const bogus = Uint8Array.from([0x4d, 0x06, 0x00, 0x1f, 0xff, 0xff, 0xff, 0x7f, 0x00])
    expect(() => parseMpy(bogus)).toThrow(/more entries than it has bytes/)
  })

  it('fails cleanly at every truncation of a valid file', () => {
    const whole = fixture('blinker.mpy')
    for (let len = 0; len < whole.length; len++) {
      const cut = whole.subarray(0, len)
      let thrown: unknown = null
      try {
        parseMpy(cut)
      } catch (e) {
        thrown = e
      }
      // Never a silent success, and never a RangeError / stack overflow: a short
      // file always comes back as something we can put in front of a user.
      expect(thrown, `truncation at ${len} bytes did not fail`).toBeInstanceOf(MpyReadError)
      expect((thrown as Error).message).toMatch(/\w/)
    }
    // The sanity half of the fuzz: the untruncated file still parses.
    expect(parseMpy(whole).module.children).toHaveLength(2)
  })

  it('fails cleanly on every single-byte corruption of the tables', () => {
    // Flip a byte in the qstr/constant/raw-code region and the parse may still
    // succeed (a length that stays in range is not detectably wrong), but it
    // must never throw anything other than an MpyReadError.
    const whole = fixture('blinker.mpy')
    for (let at = 4; at < whole.length; at++) {
      const bent = Uint8Array.from(whole)
      bent[at] = bent[at] ^ 0xff
      try {
        parseMpy(bent)
      } catch (e) {
        expect(e, `byte ${at} threw a non-MpyReadError`).toBeInstanceOf(MpyReadError)
      }
    }
  })
})

describe('isMpyFile', () => {
  it('matches a .mpy by name, case-insensitively, and nothing else', () => {
    expect(isMpyFile('driver.mpy')).toBe(true)
    expect(isMpyFile('/lib/adafruit_bus_device/i2c_device.MPY')).toBe(true)
    expect(isMpyFile('main.py')).toBe(false)
    expect(isMpyFile('mpy')).toBe(false)
    expect(isMpyFile('notes.mpy.txt')).toBe(false)
    expect(isMpyFile(undefined)).toBe(false)
    expect(isMpyFile(null)).toBe(false)
  })
})
