import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  heldSerialPort,
  replPortConflict,
  retryAction,
  type ConnectionSnapshot
} from '../src/shared/flash-dialog'
import { VIRTUAL_PORT_PATH } from '../src/shared/virtual-device'

/**
 * #845 — Detect silently failed while the board was connected.
 * #838 — a finished flash had one way out, and it lost every selection.
 *
 * The decisions live in `shared/flash-dialog.ts` so they can be checked here
 * without a board or a window; the wiring is checked at SOURCE level for the
 * reason `flasherSimpleMode.test.ts` gives — the dialog is Electron-only, so
 * `isElectron()` is false under a renderer and every branch that matters is
 * skipped.
 */
const SRC = readFileSync(
  join(__dirname, '..', 'src/renderer/src/components/FirmwareFlasher.tsx'),
  'utf-8'
)

const connected = (path?: string): ConnectionSnapshot => ({ state: 'connected', path })

describe('#845 — the port the REPL is holding', () => {
  it('reports the port Snakie has open', () => {
    expect(heldSerialPort(connected('/dev/cu.usbserial-10'))).toBe('/dev/cu.usbserial-10')
  })

  it('counts a connection still being opened — esptool loses that race too', () => {
    expect(heldSerialPort({ state: 'connecting', path: 'COM4' })).toBe('COM4')
  })

  it('holds nothing when disconnected, errored, or pathless', () => {
    expect(heldSerialPort({ state: 'disconnected', path: '/dev/ttyUSB0' })).toBeNull()
    expect(heldSerialPort({ state: 'error', path: '/dev/ttyUSB0' })).toBeNull()
    expect(heldSerialPort({ state: 'connected' })).toBeNull()
    expect(heldSerialPort(undefined)).toBeNull()
  })

  it('does not count the simulated device — it holds no hardware', () => {
    // `snakie://virtual` is a sentinel, not a port (#135). Blocking Detect on it
    // would be a warning about a conflict that cannot exist.
    expect(heldSerialPort(connected(VIRTUAL_PORT_PATH))).toBeNull()
  })

  it('conflicts when Detect is about to hand esptool the very port it holds', () => {
    const c = replPortConflict(connected('/dev/ttyUSB0'), '/dev/ttyUSB0')
    expect(c?.port).toBe('/dev/ttyUSB0')
    // The point of the fix: the reason names the port AND the app holding it,
    // instead of the BOOT/RESET advice that cannot fix this.
    expect(c?.reason).toContain('/dev/ttyUSB0')
    expect(c?.reason).toMatch(/REPL/)
    expect(c?.reason).toMatch(/[Dd]isconnect/)
  })

  it('reports it even when detection recognised no serial board at all', () => {
    // An open REPL proves a board is plugged in; "found nothing" alongside that
    // is the same complaint wearing a different hat.
    expect(replPortConflict(connected('/dev/ttyUSB0'))?.port).toBe('/dev/ttyUSB0')
  })

  it('stays quiet about a DIFFERENT port — two boards, one connected', () => {
    // Connected to one board, flashing the other: nothing is in the way.
    expect(replPortConflict(connected('/dev/ttyUSB0'), '/dev/ttyUSB1')).toBeNull()
  })

  it('stays quiet when nothing is connected', () => {
    expect(replPortConflict({ state: 'disconnected' }, '/dev/ttyUSB0')).toBeNull()
  })
})

describe('#845 — Detect asks before esptool does', () => {
  const detect = /const detectBoard = useCallback\(async[\s\S]*?\n {2}\}, \[[^\]]*\]\)/.exec(SRC)

  it('checks the connection and bails out before identifying', () => {
    expect(detect, 'detectBoard not found').toBeTruthy()
    const body = detect![0]
    expect(body).toContain('replPortConflict')
    expect(body).toContain('setDetectConflict')
    // The bail-out has to come BEFORE the esptool call, or the check has bought
    // nothing: esptool still fails and still reports an empty identity.
    expect(body.indexOf('setDetectConflict')).toBeLessThan(body.indexOf('identifyBoard('))
    expect(body).toMatch(/if \(conflict\) return/)
  })

  it('exempts a drive board — BOOTSEL needs no serial port', () => {
    expect(detect![0]).toMatch(/drive && !serial/)
  })

  it('offers to disconnect rather than doing it behind the user’s back', () => {
    const fn = /const disconnectAndDetect = useCallback\(async[\s\S]*?\n {2}\}, \[[^\]]*\]\)/.exec(SRC)
    expect(fn, 'disconnectAndDetect not found').toBeTruthy()
    expect(fn![0]).toContain('window.api.device.disconnect()')
    // It re-detects with the check skipped: the status push confirming the
    // disconnect has not landed yet, so the check would still see it connected.
    expect(fn![0]).toContain('detectBoard(true)')
    // …and the button that calls it is the ONLY route to it. Detect itself must
    // never disconnect a board that may be mid-run.
    expect(SRC).toContain('Disconnect and detect')
    expect(detect![0]).not.toContain('device.disconnect')
  })
})

describe('#838 — a second way out of a finished run', () => {
  it('offers nothing to go back to while the run is still being set up', () => {
    expect(retryAction('idle')).toBeNull()
  })

  it('offers a retry after a failure and another flash after a success', () => {
    expect(retryAction('error')?.label).toMatch(/try again/i)
    expect(retryAction('success')?.label).toMatch(/flash another/i)
    for (const outcome of ['error', 'success'] as const) {
      // Both say the same thing about what survives, because both do.
      expect(retryAction(outcome)?.title).toMatch(/still selected/i)
    }
  })

  it('the finished footer renders it beside Done', () => {
    const footer = /<footer className="firmware-modal__footer">[\s\S]*?<\/footer>/.exec(SRC)
    expect(footer, 'footer not found').toBeTruthy()
    expect(footer![0]).toContain('retry.label')
    expect(footer![0]).toContain('onClick={clearRun}')
    // Done still closes; going back must not.
    expect(footer![0]).toContain('onClick={onClose}')
  })

  it('going back clears the RUN and nothing the user chose', () => {
    const fn = /const clearRun = useCallback\(\(\): void => \{[\s\S]*?\n {2}\}, \[\]\)/.exec(SRC)
    expect(fn, 'clearRun not found').toBeTruthy()
    const body = fn![0]
    for (const run of ['setLog([])', 'setPercent(null)', "setOutcome('idle')"]) {
      expect(body, `clearRun should reset ${run}`).toContain(run)
    }
    // The whole point of the issue: everything chosen to get here survives.
    for (const setter of [
      'setRuntime',
      'setBoard',
      'setProfileId',
      'setPort',
      'setMountPath',
      'setOffset',
      'setFirmwarePath',
      'setEraseFirst',
      'setSource',
      'setCatalog',
      'setSelFamily',
      'setSelModel',
      'setSelVariant',
      'setSelVersionUrl',
      'setUseRecommended'
    ]) {
      expect(body, `clearRun must not touch ${setter} — that is a selection`).not.toContain(setter)
    }
  })

  it('starting a flash goes through the same clear, so the two cannot drift', () => {
    const fn = /const resetRun = useCallback\(\(\): void => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\)/.exec(SRC)
    expect(fn, 'resetRun not found').toBeTruthy()
    expect(fn![0]).toContain('clearRun()')
    expect(fn![0]).toContain('setFlashing(true)')
  })
})
