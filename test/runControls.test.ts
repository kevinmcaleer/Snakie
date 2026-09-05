import { describe, expect, it } from 'vitest'
import { BOOT_FILE_ORDER, bootFile, bootRoleFor, runTitle, stopTitle } from '../src/renderer/src/components/run-controls'

/**
 * RUN / STOP / RESET SEMANTICS (#755, epic #209).
 *
 * The wording IS the deliverable: Run behaves identically on both runtimes (a
 * raw-REPL exec), and what changes is what that costs the user — on
 * CircuitPython their `code.py` stops and does not come back. So these tests
 * are about what the app promises, and about the boot-file rule, which is a
 * real trap: a board carrying both `code.py` and `main.py` runs only the first.
 *
 * The startup marker (#872) is the other half. The orders asserted below are the
 * runtimes' OWN (CircuitPython `main.c`'s `boot_py_filenames` /
 * `supported_filenames`; MicroPython `ports/rp2/main.c`), not a guide's — and
 * the cases where the marker must stay SILENT matter as much as the ones where
 * it speaks, because a confident wrong label about which file a board runs is
 * worse than no label at all.
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
    expect(bootFile(['main.txt', 'main.py'], 'circuitpython')).toBe('main.py')
    expect(bootFile(['main.txt'], 'circuitpython')).toBe('main.txt')
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

  it('finds the SETUP file too — a separate pass from the program', () => {
    expect(bootFile(['boot.py', 'main.py'], 'micropython', 'boot')).toBe('boot.py')
    expect(bootFile(['boot.py', 'code.py'], 'circuitpython', 'boot')).toBe('boot.py')
    // boot.py wins over boot.txt; boot.txt runs when it is on its own.
    expect(bootFile(['boot.txt', 'boot.py'], 'circuitpython', 'boot')).toBe('boot.py')
    expect(bootFile(['boot.txt'], 'circuitpython', 'boot')).toBe('boot.txt')
    // MicroPython has no .txt form at all.
    expect(bootFile(['boot.txt'], 'micropython', 'boot')).toBeNull()
  })

  it("the orders are the runtimes' own — main.py comes BEFORE main.txt", () => {
    // CircuitPython main.c: supported_filenames[] = {"code.txt", "code.py",
    // "main.py", "main.txt"}. Adafruit's learn guide prints the last two the
    // other way round; the source is what actually runs on the board.
    expect(BOOT_FILE_ORDER.circuitpython.main).toEqual([
      'code.txt',
      'code.py',
      'main.py',
      'main.txt'
    ])
    expect(BOOT_FILE_ORDER.circuitpython.boot).toEqual(['boot.py', 'boot.txt'])
    expect(BOOT_FILE_ORDER.micropython).toEqual({ boot: ['boot.py'], main: ['main.py'] })
  })
})

describe('bootRoleFor', () => {
  it('marks the file that runs', () => {
    expect(bootRoleFor('code.py', ['code.py', 'lib'], 'circuitpython')).toEqual({
      label: 'runs at boot',
      title: 'CircuitPython runs this file when the board starts',
      shadowed: false
    })
  })

  it('explains the SHADOWED file, which is the whole point — editing it does nothing', () => {
    expect(bootRoleFor('main.py', ['code.py', 'main.py'], 'circuitpython')).toEqual({
      label: 'ignored',
      title: 'CircuitPython runs code.py instead — it comes first, so this file is ignored',
      shadowed: true
    })
  })

  it('says nothing about an ordinary file', () => {
    expect(bootRoleFor('helpers.py', ['code.py', 'helpers.py'], 'circuitpython')).toBeNull()
    expect(bootRoleFor('lib', ['code.py', 'lib'], 'circuitpython')).toBeNull()
    // boot_out.txt is what the board WROTE, not something it runs.
    expect(bootRoleFor('boot_out.txt', ['boot_out.txt'], 'circuitpython')).toBeNull()
  })

  it('says nothing when the runtime is not known, rather than guessing', () => {
    // The point of #209: an unlabelled main.py beats one confidently labelled
    // "runs at boot" on a board that turns out to be CircuitPython.
    expect(bootRoleFor('code.py', ['code.py'], undefined)).toBeNull()
    expect(bootRoleFor('boot.py', ['boot.py'], undefined)).toBeNull()
    expect(bootRoleFor('main.py', ['main.py'], 'unknown')).toBeNull()
  })

  it('does not call code.py a boot file on MicroPython', () => {
    expect(bootRoleFor('code.py', ['code.py', 'main.py'], 'micropython')).toBeNull()
    expect(bootRoleFor('main.py', ['code.py', 'main.py'], 'micropython')?.label).toBe('runs at boot')
  })

  it('labels boot.py on MicroPython as the setup pass that runs at every reset', () => {
    const role = bootRoleFor('boot.py', ['boot.py', 'main.py'], 'micropython')
    expect(role?.label).toBe('runs first')
    expect(role?.shadowed).toBe(false)
    expect(role?.title).toContain('MicroPython')
    expect(role?.title).toContain('every reset')
    expect(role?.title).toContain('main.py')
  })

  it('labels boot.py on CircuitPython with what is different there — once, before USB', () => {
    const role = bootRoleFor('boot.py', ['boot.py', 'code.py'], 'circuitpython')
    expect(role?.label).toBe('runs first')
    expect(role?.shadowed).toBe(false)
    expect(role?.title).toContain('CircuitPython')
    expect(role?.title).toContain('once at power-on')
    expect(role?.title).toContain('USB')
    // The runtimes genuinely disagree here, so the two tooltips must not match.
    expect(role?.title).not.toBe(bootRoleFor('boot.py', ['boot.py'], 'micropython')?.title)
  })

  it('never lets boot.py shadow the program — both passes run, on both runtimes', () => {
    for (const dialect of ['micropython', 'circuitpython'] as const) {
      const program = dialect === 'micropython' ? 'main.py' : 'code.py'
      const role = bootRoleFor(program, ['boot.py', program], dialect)
      expect(role?.shadowed).toBe(false)
      expect(role?.label).toBe('runs at boot')
      // …and it says which file went first, so the order is visible.
      expect(role?.title).toContain('after boot.py')
    }
  })

  it('names the setup file that is really there, not a hardcoded boot.py', () => {
    expect(bootRoleFor('code.py', ['boot.txt', 'code.py'], 'circuitpython')?.title).toContain(
      'after boot.txt'
    )
    // No setup file at all: no dangling "after" clause.
    expect(bootRoleFor('code.py', ['code.py'], 'circuitpython')?.title).toBe(
      'CircuitPython runs this file when the board starts'
    )
  })

  it('marks a shadowed boot.txt, so the ignored setup file is not a mystery either', () => {
    expect(bootRoleFor('boot.txt', ['boot.py', 'boot.txt'], 'circuitpython')).toEqual({
      label: 'ignored',
      title: 'CircuitPython runs boot.py instead — it comes first, so this file is ignored',
      shadowed: true
    })
  })
})
