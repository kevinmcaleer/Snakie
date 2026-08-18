/**
 * WHAT RUN, STOP AND RESET MEAN ON EACH RUNTIME (#755, epic #209).
 * =============================================================================
 *
 * MicroPython runs what Snakie sends it and nothing else. CircuitPython runs
 * `code.py` from boot and reloads it whenever a file changes — so the same three
 * buttons do materially different things, and the difference is invisible
 * unless the app says so.
 *
 * Pure and unit-tested (the `updateButton.ts` pattern): the wording is the whole
 * deliverable here, so it is worth pinning rather than burying in JSX.
 *
 * **Run stays a raw-REPL exec on both runtimes.** The alternative — write the
 * file to `code.py` and let auto-reload run it — was rejected: it would overwrite
 * a file the user did not ask us to touch, and it would make Run mean something
 * different from what it means everywhere else in Snakie. What changes is only
 * the explanation: on CircuitPython, running takes over from `code.py`, and when
 * it finishes the board is sitting at the REPL rather than back in `code.py`.
 */
import type { Dialect } from '../../../shared/dialect'

/** Everything the Run button's tooltip depends on. */
export interface RunTitleState {
  /** Name of the file that would run; absent when no file is open. */
  activeFileName?: string
  connected: boolean
  connecting: boolean
  /** Which Python the board runs — absent until the connect probe answers. */
  dialect?: Dialect
}

/** Everything the Stop/Reset button's tooltip depends on. */
export interface StopTitleState {
  connected: boolean
  /** True while a program Snakie started is still going. */
  running: boolean
  dialect?: Dialect
}

/**
 * The Run button's tooltip.
 *
 * The CircuitPython wording names the consequence a user cannot otherwise
 * predict: their `code.py` stops, and it does not come back on its own.
 */
export function runTitle(s: RunTitleState): string {
  if (!s.activeFileName) return 'Open a file to run'
  if (s.connecting) return 'Connecting…'
  if (!s.connected) return 'Run on the simulator'
  if (s.dialect === 'circuitpython') {
    return `Run ${s.activeFileName} on the board. It takes over from code.py, and the board stays at the REPL afterwards rather than going back to it — press Reset to run code.py again.`
  }
  return `Run ${s.activeFileName} on the device`
}

/**
 * The Stop/Reset button's tooltip.
 *
 * Reset is where the runtimes genuinely differ: Ctrl-D soft-reboots both, but on
 * CircuitPython a soft reboot **re-runs `code.py`**, so the button is not the
 * "clear the board's state" it is on MicroPython — it starts the user's program.
 */
export function stopTitle(s: StopTitleState): string {
  if (!s.connected) return 'Connect to a device to stop'
  if (s.running) return 'Interrupt the running program (Ctrl-C)'
  if (s.dialect === 'circuitpython') {
    return 'Reset the board (soft reboot) — CircuitPython runs code.py again from the start'
  }
  return 'Reset the board (soft reboot)'
}

/**
 * The files each runtime looks for at boot, in the order it tries them. The
 * FIRST one present is the one that runs; the rest are ignored, which is the
 * trap this exists to surface — a board with both `code.py` and `main.py` runs
 * only `code.py`, and editing `main.py` then appears to do nothing.
 *
 * CircuitPython: `code.txt`, `code.py`, `main.txt`, `main.py`.
 * MicroPython: `boot.py` runs first and then `main.py`, but `boot.py` is setup
 * rather than the program, so `main.py` is the one worth pointing at.
 */
export const BOOT_FILE_ORDER: Record<'circuitpython' | 'micropython', string[]> = {
  circuitpython: ['code.txt', 'code.py', 'main.txt', 'main.py'],
  micropython: ['main.py']
}

/**
 * Which file in a device directory listing the board will actually run at boot,
 * or `null` when none of them is a boot file.
 *
 * `names` should be the ROOT listing — the boot files are only boot files there.
 * Returns the winner of the runtime's own search order, so a board carrying both
 * `code.py` and `main.py` names `code.py`.
 */
export function bootFile(names: string[], dialect?: Dialect): string | null {
  if (dialect !== 'circuitpython' && dialect !== 'micropython') return null
  const present = new Set(names)
  return BOOT_FILE_ORDER[dialect].find((f) => present.has(f)) ?? null
}

/**
 * Why a file in the root is, or is not, the one that runs — the tooltip for the
 * marker in the device file tree. `null` for a file that has nothing to say,
 * which is most of them.
 */
export function bootFileNote(name: string, names: string[], dialect?: Dialect): string | null {
  if (dialect !== 'circuitpython' && dialect !== 'micropython') return null
  const order = BOOT_FILE_ORDER[dialect]
  if (!order.includes(name)) return null
  const winner = bootFile(names, dialect)
  const runtime = dialect === 'circuitpython' ? 'CircuitPython' : 'MicroPython'
  if (name === winner) return `${runtime} runs this file when the board starts`
  return `${runtime} runs ${winner} instead — it comes first, so this file is ignored`
}
