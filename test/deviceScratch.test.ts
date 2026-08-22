import { describe, it, expect } from 'vitest'
import {
  SCRATCH_PREFIX,
  delScratch,
  isScratchName,
  scratchName
} from '../src/shared/device-scratch'
import { RUNTIME_PROBE_PY } from '../src/shared/dialect'
import { parseVariables } from '../src/renderer/src/components/VariablesPanel'
import { SimulatedDevice } from '../src/main/device/SimulatedDevice'

/**
 * SNAKIE'S OWN GLOBALS (#798).
 *
 * A raw-REPL snippet runs in the board's `__main__`, so every temporary Snakie
 * binds is a global on the user's board — which the Inspect panel then listed
 * and counted as if the user had written it.
 *
 * Two halves are tested here:
 *
 *  1. The RULE (pure): one prefix decides what is ours, and the cleanup Python
 *     can only ever delete names that rule would also hide. That agreement is
 *     what stops the two from drifting apart the next time a snippet adds a
 *     temporary.
 *  2. The BEHAVIOUR (integration, on the real WebAssembly MicroPython): after a
 *     full round of device work — write, read, list, stat, line-read, remove —
 *     the board's globals hold the user's names and nothing else. This is the
 *     bug as reported, so it is tested where it actually happens rather than
 *     against a restatement of the snippets.
 */

describe('scratch names', () => {
  it('recognises every name it builds', () => {
    for (const base of ['f', 'd', 'st', 'ls', 'cur', 'isdir']) {
      expect(isScratchName(scratchName(base))).toBe(true)
    }
  })

  it('does not claim a user variable that merely starts with an underscore', () => {
    // The temporaries used to be single letters (`_s`, `_d`, `_f`) — names a
    // user could plausibly choose, so no filter could tell them apart.
    for (const name of ['_s', '_d', '_f', '_', '__x', 'snk', '_snk', 'x_snk_y']) {
      expect(isScratchName(name)).toBe(false)
    }
  })

  it('refuses to delete a name the filter would not hide', () => {
    // The anti-drift guard: a snippet cannot clean up a name that would still be
    // shown as the user's if the cleanup did not run.
    expect(() => delScratch('_s')).toThrow(/scratch/)
    expect(() => delScratch(scratchName('f'), 'st')).toThrow(/st/)
  })

  it('guards the delete so a snippet that never bound a name still succeeds', () => {
    const py = delScratch(scratchName('f'), scratchName('b'))
    // MicroPython raises KeyError (not NameError) for `del <missing global>`, so
    // a NameError-only guard would abort the snippet on a real board.
    expect(py).toContain('NameError')
    expect(py).toContain('KeyError')
    // Always-bound names first: `del` unbinds left to right and stops at the
    // first missing one, so ordering decides how much cleanup survives.
    expect(py.indexOf('_snk_f')).toBeLessThan(py.indexOf('_snk_b'))
  })

  it('emits nothing for nothing', () => {
    expect(delScratch()).toBe('')
  })

  it('cleans up after the runtime probe — the first snippet any board runs', () => {
    // The probe fires on connect, so anything it left bound would be the first
    // thing the Inspect panel showed as the user's variables.
    expect(RUNTIME_PROBE_PY).toContain(SCRATCH_PREFIX)
    expect(RUNTIME_PROBE_PY).toContain('del ')
    // No bare single-letter temporaries left in the probe.
    expect(/^\s*_[a-z]\s*=/m.test(RUNTIME_PROBE_PY)).toBe(false)
  })
})

describe('the variables inspector counts the user\'s program only', () => {
  const FS = '␟'
  const dump = (...rows: string[]): string =>
    ['<<SNAKIE_VARS>>', ...rows, '<<SNAKIE_VARS_END>>'].join('\n')

  it('drops Snakie\'s scratch globals from the list AND from the count', () => {
    const vars = parseVariables(
      dump(
        `SPRITE${FS}bytes${FS}b'\\x00'`,
        `_snk_f${FS}FileIO${FS}<io.FileIO -1>`,
        `_snk_s${FS}tuple${FS}(4096, 4096, 1000000)`,
        `matrix${FS}Matrix${FS}<Matrix>`
      )
    )
    expect(vars.map((v) => v.name)).toEqual(['SPRITE', 'matrix'])
  })

  it('keeps a user variable whose name merely looks internal', () => {
    const vars = parseVariables(dump(`_s${FS}int${FS}1`, `_${FS}int${FS}2`))
    expect(vars.map((v) => v.name)).toEqual(['_s', '_'])
  })
})

describe('the board is left with the user\'s globals only (real interpreter)', () => {
  /** Every global the board is holding, as the inspector's snippet would see it. */
  async function globalsOn(dev: SimulatedDevice): Promise<string[]> {
    const { stdout } = await dev.exec(
      "print('NAMES', ' '.join(k for k in list(globals().keys()) if not k.startswith('__')))"
    )
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith('NAMES'))
    return (line ?? '')
      .slice('NAMES'.length)
      .trim()
      .split(/\s+/)
      .filter((n) => n.length > 0)
  }

  it('leaves nothing behind after a write / read / list / stat / remove round', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      // The user's own program state, which must survive everything below.
      await dev.exec("SPRITE = b'\\x01\\x02'\nmatrix = [1, 2, 3]")

      await dev.writeFile('/lib/simple_eyes.py', '"""simple_eyes — a demo."""\nVALUE = 1\n')
      await dev.readFile('/lib/simple_eyes.py')
      await dev.readFileLine('/lib/simple_eyes.py', 'VALUE')
      await dev.listDir('/lib')
      await dev.stat('/lib/simple_eyes.py')
      await dev.remove('/lib/simple_eyes.py')

      const names = await globalsOn(dev)
      expect(names).toContain('SPRITE')
      expect(names).toContain('matrix')
      // The reported symptom: `f`, `_d` and `_s` sitting in the user's globals.
      expect(names.filter((n) => isScratchName(n))).toEqual([])
      expect(names).not.toContain('f')
      expect(names).not.toContain('_d')
      expect(names).not.toContain('_s')
    } finally {
      await dev.dispose()
    }
  }, 30000)

  it('runs the connect-time runtime probe and leaves nothing bound', async () => {
    // The probe only ever runs against real hardware, so this is the one place
    // it is executed by an actual interpreter: it must parse, print its three
    // sentinels, and unbind its six temporaries.
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      const { stdout } = await dev.exec(RUNTIME_PROBE_PY)
      expect(stdout).toContain('SNKIMPL micropython')
      expect((await globalsOn(dev)).filter((n) => isScratchName(n))).toEqual([])
    } finally {
      await dev.dispose()
    }
  }, 30000)

  it('cleans up even when the snippet fails (a file that is not there)', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      // `readFileLine` swallows a missing file; `remove` raises. Both must leave
      // the namespace as they found it — a failed transfer is exactly when a
      // confused user opens the inspector.
      await dev.readFileLine('/nope.py', 'V')
      await dev.remove('/nope.py').catch(() => undefined)
      expect((await globalsOn(dev)).filter((n) => isScratchName(n))).toEqual([])
    } finally {
      await dev.dispose()
    }
  }, 30000)
})
