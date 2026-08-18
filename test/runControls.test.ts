import { describe, expect, it } from 'vitest'
import { BOOT_FILE_ORDER, bootFile, bootFileNote, runTitle, stopTitle } from '../src/renderer/src/components/run-controls'

/**
 * RUN / STOP / RESET SEMANTICS (#755, epic #209).
 *
 * The wording IS the deliverable: Run behaves identically on both runtimes (a
 * raw-REPL exec), and what changes is what that costs the user — on
 * CircuitPython their `code.py` stops and does not come back. So these tests
 * are about what the app promises, and about the boot-file rule, which is a
 * real trap: a board carrying both `code.py` and `main.py` runs only the first.
 */

describe('runTitle', () => {
  it('is unchanged for MicroPython — this issue changes explanation, not behaviour', () => {
    expect(runTitle({ activeFileName: 'blink.py', connected: true, connecting: false, dialect: 'micropython' })).toBe(
      'Run blink.py on the device'
    )
  })

  it('warns a CircuitPython user that running stops code.py and does not resume it', () => {
    const title = runTitle({
      activeFileName: 'blink.py',
      connected: true,
      connecting: false,
      dialect: 'circuitpython'
    })
    expect(title).toContain('blink.py')
    expect(title).toContain('code.py')
    expect(title).toMatch(/Reset/) // names the way back
  })

  it('says nothing runtime-specific before the connect probe has answered', () => {
    expect(runTitle({ activeFileName: 'blink.py', connected: true, connecting: false })).toBe(
      'Run blink.py on the device'
    )
  })

  it('keeps the states that come before the runtime matters', () => {
    expect(runTitle({ connected: true, connecting: false })).toBe('Open a file to run')
    expect(runTitle({ activeFileName: 'a.py', connected: false, connecting: true })).toBe('Connecting…')
    expect(runTitle({ activeFileName: 'a.py', connected: false, connecting: false })).toBe('Run on the simulator')
  })

  it('does not promise CircuitPython behaviour while disconnected', () => {
    const title = runTitle({
      activeFileName: 'a.py',
      connected: false,
      connecting: false,
      dialect: 'circuitpython'
    })
    expect(title).toBe('Run on the simulator')
  })
})

describe('stopTitle', () => {
  it('is unchanged for MicroPython', () => {
    expect(stopTitle({ connected: true, running: false, dialect: 'micropython' })).toBe(
      'Reset the board (soft reboot)'
    )
    expect(stopTitle({ connected: true, running: true, dialect: 'micropython' })).toBe(
      'Interrupt the running program (Ctrl-C)'
    )
  })

  it('says that a CircuitPython reset RUNS code.py, rather than just clearing state', () => {
    const title = stopTitle({ connected: true, running: false, dialect: 'circuitpython' })
    expect(title).toContain('code.py')
    expect(title).toMatch(/again/)
  })

  it('interrupting means the same thing on both, so the wording does not fork', () => {
    expect(stopTitle({ connected: true, running: true, dialect: 'circuitpython' })).toBe(
      stopTitle({ connected: true, running: true, dialect: 'micropython' })
    )
  })

  it('disconnected wins over everything', () => {
    expect(stopTitle({ connected: false, running: true, dialect: 'circuitpython' })).toBe(
      'Connect to a device to stop'
    )
  })
})

describe('bootFile', () => {
  it('picks code.py on CircuitPython, which is what the board actually runs', () => {
    expect(bootFile(['code.py', 'lib', 'boot_out.txt'], 'circuitpython')).toBe('code.py')
  })

  it('resolves the trap: with BOTH code.py and main.py, only code.py runs', () => {
    expect(bootFile(['main.py', 'code.py'], 'circuitpython')).toBe('code.py')
  })

  it('follows the whole search order, including the .txt forms', () => {
    expect(bootFile(['main.py', 'code.txt'], 'circuitpython')).toBe('code.txt')
    expect(bootFile(['main.py', 'main.txt'], 'circuitpython')).toBe('main.txt')
    expect(bootFile(['main.py'], 'circuitpython')).toBe('main.py')
  })

  it('is main.py on MicroPython — and code.py is NOT special there', () => {
    expect(bootFile(['main.py', 'code.py'], 'micropython')).toBe('main.py')
    expect(bootFile(['code.py'], 'micropython')).toBeNull()
  })

  it('is null when the board runs nothing at boot, or when the runtime is unknown', () => {
    expect(bootFile(['lib', 'notes.txt'], 'circuitpython')).toBeNull()
    expect(bootFile(['code.py'], undefined)).toBeNull()
    expect(bootFile(['code.py'], 'unknown')).toBeNull()
  })

  it('the CircuitPython order is the documented one', () => {
    expect(BOOT_FILE_ORDER.circuitpython).toEqual(['code.txt', 'code.py', 'main.txt', 'main.py'])
  })
})

describe('bootFileNote', () => {
  it('marks the file that runs', () => {
    expect(bootFileNote('code.py', ['code.py', 'lib'], 'circuitpython')).toBe(
      'CircuitPython runs this file when the board starts'
    )
  })

  it('explains the SHADOWED file, which is the whole point — editing it does nothing', () => {
    const note = bootFileNote('main.py', ['code.py', 'main.py'], 'circuitpython')
    expect(note).toBe('CircuitPython runs code.py instead — it comes first, so this file is ignored')
  })

  it('says nothing about an ordinary file', () => {
    expect(bootFileNote('helpers.py', ['code.py', 'helpers.py'], 'circuitpython')).toBeNull()
    expect(bootFileNote('lib', ['code.py', 'lib'], 'circuitpython')).toBeNull()
  })

  it('says nothing when the runtime is not known, rather than guessing', () => {
    expect(bootFileNote('code.py', ['code.py'], undefined)).toBeNull()
  })

  it('does not call code.py a boot file on MicroPython', () => {
    expect(bootFileNote('code.py', ['code.py', 'main.py'], 'micropython')).toBeNull()
    expect(bootFileNote('main.py', ['code.py', 'main.py'], 'micropython')).toBe(
      'MicroPython runs this file when the board starts'
    )
  })
})
