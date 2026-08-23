import { describe, it, expect } from 'vitest'
import {
  PURGE_MARKER,
  modulesTouched,
  parsePurgeCount,
  purgeModuleSnippet,
  purgeNote,
  topLevelModuleName
} from '../src/shared/module-cache'
import { isScratchName } from '../src/shared/device-scratch'
import { SimulatedDevice } from '../src/main/device/SimulatedDevice'

/**
 * #784 — a driver install left the board using its cached, broken import.
 *
 * The reported session cost about a dozen exchanges to diagnose, because every
 * check said the install was fine: the file on disk was byte-for-byte correct
 * and exported the missing symbol, yet the import kept failing. MicroPython had
 * cached the half-built module from an EARLIER, failed install, and every retry
 * got that cache back instead of re-reading the disk.
 *
 * So the test that matters is not "does the snippet parse" — it is "does the
 * documented symptom actually reproduce, and does the fix actually clear it".
 * The suite below does both against the REAL MicroPython interpreter, which is
 * the only thing that can answer either question.
 */

describe('topLevelModuleName', () => {
  it('names the PACKAGE for a file inside one, not the file', () => {
    // The whole point: dropping `modulino.helpers` while keeping `modulino`
    // leaves the stale package object that produced the reported error.
    expect(topLevelModuleName('/lib/modulino/helpers.py')).toBe('modulino')
    expect(topLevelModuleName('/lib/modulino/__init__.py')).toBe('modulino')
    expect(topLevelModuleName('/lib/foo/bar/baz.py')).toBe('foo')
  })

  it('names a single-file module', () => {
    expect(topLevelModuleName('/lib/ssd1306.py')).toBe('ssd1306')
    expect(topLevelModuleName('ssd1306.py')).toBe('ssd1306')
  })

  it('treats a precompiled .mpy the same as its source', () => {
    expect(topLevelModuleName('/lib/ssd1306.mpy')).toBe('ssd1306')
  })

  it('does not treat the lib folder as part of the name', () => {
    expect(topLevelModuleName('/lib/x.py')).toBe('x')
    expect(topLevelModuleName('lib/x.py')).toBe('x')
  })

  it('returns null where there is no module to name', () => {
    expect(topLevelModuleName('')).toBeNull()
    expect(topLevelModuleName('/lib/')).toBeNull()
    expect(topLevelModuleName('/lib/__init__.py')).toBeNull()
  })

  it('refuses a name that could not be imported anyway', () => {
    // A malformed name must not be interpolated into a snippet.
    expect(topLevelModuleName('/lib/2bad.py')).toBeNull()
    expect(topLevelModuleName('/lib/with-dash.py')).toBeNull()
    expect(topLevelModuleName('/lib/has space.py')).toBeNull()
  })
})

describe('modulesTouched', () => {
  it('collapses a package written as many files to ONE name', () => {
    expect(
      modulesTouched(['/lib/modulino/__init__.py', '/lib/modulino/helpers.py', '/lib/ssd1306.py'])
    ).toEqual(['modulino', 'ssd1306'])
  })

  it('ignores paths that name no module', () => {
    expect(modulesTouched(['/lib/', '/lib/2bad.py'])).toEqual([])
  })
})

describe('purgeModuleSnippet', () => {
  it('refuses a name that is not importable, rather than emitting bad Python', () => {
    expect(() => purgeModuleSnippet('with-dash')).toThrow(/importable/i)
    expect(() => purgeModuleSnippet('2bad')).toThrow(/importable/i)
  })

  it('uses only scratch-prefixed globals, so nothing of ours is left on the board', () => {
    const code = purgeModuleSnippet('modulino')
    // Every assignment target in the snippet must be one the inspector hides.
    for (const m of code.matchAll(/^(\w+) = /gm)) {
      expect(isScratchName(m[1]), `${m[1]} is not a scratch name`).toBe(true)
    }
  })

  it('matches submodules by a DOTTED prefix, so a similar name is not swept up', () => {
    // `modulino` must not take `modulinox` with it.
    expect(purgeModuleSnippet('modulino')).toContain('+ "."')
  })
})

describe('parsePurgeCount', () => {
  it('reads the count the snippet printed', () => {
    expect(parsePurgeCount(`${PURGE_MARKER}3`)).toBe(3)
    expect(parsePurgeCount(`noise\r\n${PURGE_MARKER}0\r\nmore`)).toBe(0)
  })

  it('reads zero from output that never reported, rather than guessing', () => {
    expect(parsePurgeCount('')).toBe(0)
    expect(parsePurgeCount('OSError: 30')).toBe(0)
  })
})

describe('purgeNote', () => {
  it('says nothing when nothing was cached — the common case', () => {
    // Reporting every install would be noise that hides the one that matters.
    expect(purgeNote(['modulino'], 0)).toBeUndefined()
    expect(purgeNote([], 2)).toBeUndefined()
  })

  it('names the module, and is honest about what a purge cannot undo', () => {
    const note = purgeNote(['modulino'], 2) ?? ''
    expect(note).toContain('modulino')
    // A name already bound from the stale module keeps pointing at it; claiming
    // otherwise would set up the next confusing session.
    expect(note).toMatch(/already imported from it|reset the board/i)
  })
})

// ---------------------------------------------------------------------------
// Against the real MicroPython interpreter
// ---------------------------------------------------------------------------

describe('the stale import cache, on a real interpreter (#784)', () => {
  /** Every global the board holds, as the inspector's snippet would see it. */
  async function globalsOn(dev: SimulatedDevice): Promise<string[]> {
    const { stdout } = await dev.exec(
      "print('NAMES', ' '.join(k for k in list(globals().keys()) if not k.startswith('__')))"
    )
    const line = stdout.split(/\r?\n/).find((l) => l.startsWith('NAMES'))
    return (line ?? '').slice('NAMES'.length).trim().split(/\s+/).filter((n) => n.length > 0)
  }

  it('reproduces the bug, and the purge fixes it — without losing REPL state', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      await dev.exec('import sys\nsys.path.insert(0, "/lib")')
      // The user's own session state, which a soft reset would destroy and this
      // fix must preserve — that is the whole reason for a targeted purge.
      await dev.exec("SPRITE = b'\\x01\\x02'\nmatrix = [1, 2, 3]")

      // 1. The BROKEN install: the package exists but lacks the symbol.
      await dev.mkdir('/lib/modulino').catch(() => undefined)
      await dev.writeFile('/lib/modulino/__init__.py', 'VALUE = 1\n')

      // 2. The user imports it. This is what poisons sys.modules.
      await dev.exec('import modulino')

      // 3. The install is repaired on disk — byte-for-byte correct.
      await dev.writeFile('/lib/modulino/__init__.py', 'VALUE = 1\ndef map_value():\n    return 42\n')

      // 4. The reported symptom: a fresh import STILL serves the cached copy.
      const stale = await dev.exec(
        'import modulino\nprint("HAS", hasattr(modulino, "map_value"))'
      )
      expect(stale.stdout, 'the stale cache should still be serving the old module').toContain(
        'HAS False'
      )

      // 5. The fix.
      const purge = await dev.exec(purgeModuleSnippet('modulino'))
      expect(parsePurgeCount(purge.stdout)).toBeGreaterThan(0)

      // 6. The next import reads the disk.
      const fresh = await dev.exec(
        'import modulino\nprint("HAS", hasattr(modulino, "map_value"))\nprint("VAL", modulino.map_value())'
      )
      expect(fresh.stdout).toContain('HAS True')
      expect(fresh.stdout).toContain('VAL 42')

      // 7. And the user still has their session — the point of not soft-resetting.
      const names = await globalsOn(dev)
      expect(names).toContain('SPRITE')
      expect(names).toContain('matrix')
      // 8. ...and none of Snakie's own names were left behind (#798's rule).
      expect(names.filter((n) => isScratchName(n))).toEqual([])
    } finally {
      await dev.dispose()
    }
  }, 30_000)

  it('does not sweep away a module with a similar name', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      await dev.exec('import sys\nsys.path.insert(0, "/lib")')
      await dev.writeFile('/lib/modx.py', 'A = 1\n')
      await dev.writeFile('/lib/modxtra.py', 'B = 2\n')
      await dev.exec('import modx\nimport modxtra')

      await dev.exec(purgeModuleSnippet('modx'))

      const { stdout } = await dev.exec(
        'import sys\nprint("MODX", "modx" in sys.modules)\nprint("EXTRA", "modxtra" in sys.modules)'
      )
      expect(stdout).toContain('MODX False')
      // The prefix match is dotted, so the unrelated neighbour survives.
      expect(stdout).toContain('EXTRA True')
    } finally {
      await dev.dispose()
    }
  }, 30_000)

  it('is harmless on a module the board never imported', async () => {
    const dev = new SimulatedDevice()
    await dev.connect()
    try {
      const { stdout } = await dev.exec(purgeModuleSnippet('never_imported_here'))
      expect(parsePurgeCount(stdout)).toBe(0)
      // A no-op purge must not look like a failure to the installer.
      expect(stdout).not.toMatch(/Traceback|Error/i)
    } finally {
      await dev.dispose()
    }
  }, 30_000)
})
